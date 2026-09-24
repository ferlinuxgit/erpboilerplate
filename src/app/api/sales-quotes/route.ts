import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { customer, salesQuote, salesQuoteLine } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { settle } from "@/lib/settle";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";
import { computeDocumentTotals } from "@/server/taxation/engine";
import { rejectForeignItems } from "@/server/inventory/ownership";

const lineSchema = z.object({
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().nonnegative().optional(),
  retentionRate: z.number().nonnegative().optional(),
  discountPct: z.number().nonnegative().optional(),
});

const payloadSchema = z.object({
  customerId: z.string().trim().min(1),
  number: z.string().trim().optional().or(z.literal("")),
  issueDate: z.string().trim().min(1),
  validUntil: z.string().trim().optional().or(z.literal("")),
  lines: z.array(
    lineSchema.extend({
      description: z.string().trim().optional().or(z.literal("")),
      itemId: z.string().trim().optional().or(z.literal("")),
    }),
  ).min(1),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(salesQuote).where(eq(salesQuote.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [ownedCustomer] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, parsed.data.customerId), eq(customer.companyId, ctx.company.id)))
    .limit(1);
  if (!ownedCustomer) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });

  const foreignItems = await rejectForeignItems(db, ctx.company.id, parsed.data.lines);
  if (foreignItems) return foreignItems;
  const totals = computeDocumentTotals(parsed.data.lines);
  const issueDate = new Date(parsed.data.issueDate);
  if (Number.isNaN(issueDate.getTime())) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });
  const result = await settle(db.transaction(async (tx) => {
    const number =
      parsed.data.number?.trim() ||
      (await reserveSeriesNumber(tx, {
        companyId: ctx.company.id,
        type: "SALES_QUOTE",
        referenceDate: issueDate,
        fiscalYearId: ctx.fiscalYear.id,
      }));

    const [header] = await tx.insert(salesQuote).values({
      companyId: ctx.company.id,
      customerId: parsed.data.customerId,
      number,
      issueDate,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      subtotal: totals.subtotal.toFixed(2),
      taxAmount: totals.taxAmount.toFixed(2),
      retentionAmount: totals.retentionAmount.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
    }).returning();

    await tx.insert(salesQuoteLine).values(
      parsed.data.lines.map((line) => ({
        salesQuoteId: header.id,
        itemId: line.itemId || null,
        description: line.description || "Línea de presupuesto",
        quantity: line.quantity.toFixed(3),
        unitPrice: line.unitPrice.toFixed(2),
        discountPct: (line.discountPct ?? 0).toFixed(3),
        taxRate: (line.taxRate ?? 0).toFixed(3),
        retentionRate: (line.retentionRate ?? 0).toFixed(3),
        lineTotal: computeDocumentTotals([line]).totalAmount.toFixed(2),
      })),
    );

    await recordAudit(
      {
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        action: "salesQuote.create",
        entityName: "salesQuote",
        entityId: header.id,
        payload: {
          number: header.number,
          customerId: header.customerId,
          issueDate: parsed.data.issueDate,
          validUntil: parsed.data.validUntil || null,
          totalAmount: header.totalAmount,
          lineCount: parsed.data.lines.length,
        },
      },
      tx,
    );

    return header;
  }));

  if (!result.ok) return handleRouteError(result.error, "salesQuote.create", "No se pudo crear el presupuesto.");
  return NextResponse.json(result.value, { status: 201 });
}
