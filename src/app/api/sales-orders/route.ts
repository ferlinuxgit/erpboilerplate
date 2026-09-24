import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  customer,
  salesOrder,
  salesOrderLine,
  salesQuote,
  salesQuoteLine,
} from "@/db/schema";
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
  description: z.string().trim().min(1),
  itemId: z.string().trim().optional().or(z.literal("")),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().nonnegative().optional(),
  retentionRate: z.number().nonnegative().optional(),
  discountPct: z.number().nonnegative().optional(),
});

const payloadSchema = z
  .object({
    customerId: z.string().trim().min(1),
    number: z.string().trim().optional().or(z.literal("")),
    issueDate: z.string().trim().min(1),
    salesQuoteId: z.string().trim().optional().or(z.literal("")),
    subtotal: z.number().nonnegative().optional(),
    taxAmount: z.number().nonnegative().optional(),
    retentionAmount: z.number().nonnegative().optional(),
    totalAmount: z.number().nonnegative().optional(),
    lines: z.array(lineSchema).optional(),
  })
  .superRefine((value, context) => {
    if (!value.salesQuoteId && (!value.lines || value.lines.length === 0))
      context.addIssue({
        code: "custom",
        message: "Añade al menos una línea.",
        path: ["lines"],
      });
  });

export async function GET() {
  const session = await getUserSession();
  if (!session?.user)
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.read"))
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(
    await db
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.companyId, ctx.company.id)),
  );
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user)
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.create"))
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success)
    return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [ownedCustomer] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.id, parsed.data.customerId),
        eq(customer.companyId, ctx.company.id),
      ),
    )
    .limit(1);
  if (!ownedCustomer)
    return NextResponse.json(
      { message: "Cliente no encontrado." },
      { status: 404 },
    );

  const [ownedQuote] = parsed.data.salesQuoteId
    ? await db
        .select({ id: salesQuote.id })
        .from(salesQuote)
        .where(
          and(
            eq(salesQuote.id, parsed.data.salesQuoteId),
            eq(salesQuote.companyId, ctx.company.id),
            eq(salesQuote.customerId, parsed.data.customerId),
          ),
        )
        .limit(1)
    : [];
  if (parsed.data.salesQuoteId && !ownedQuote) {
    return NextResponse.json(
      { message: "Presupuesto no encontrado." },
      { status: 404 },
    );
  }

  const foreignItems = await rejectForeignItems(db, ctx.company.id, parsed.data.lines);
  if (foreignItems) return foreignItems;
  const directTotals = parsed.data.lines?.length
    ? computeDocumentTotals(parsed.data.lines)
    : null;
  const issueDate = new Date(parsed.data.issueDate);
  if (Number.isNaN(issueDate.getTime()))
    return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });
  const result = await settle(db.transaction(async (tx) => {
    // El número de pedido siempre sale de la serie: se ignora cualquier `number` del cliente.
    const number = await reserveSeriesNumber(tx, {
      companyId: ctx.company.id,
      type: "SALES_ORDER",
      referenceDate: issueDate,
      fiscalYearId: ctx.fiscalYear.id,
    });

    const [header] = await tx
      .insert(salesOrder)
      .values({
        companyId: ctx.company.id,
        customerId: parsed.data.customerId,
        number,
        issueDate,
        salesQuoteId: parsed.data.salesQuoteId || null,
        subtotal: (directTotals?.subtotal ?? parsed.data.subtotal ?? 0).toFixed(
          2,
        ),
        taxAmount: (
          directTotals?.taxAmount ??
          parsed.data.taxAmount ??
          0
        ).toFixed(2),
        retentionAmount: (
          directTotals?.retentionAmount ??
          parsed.data.retentionAmount ??
          0
        ).toFixed(2),
        totalAmount: (
          directTotals?.totalAmount ??
          parsed.data.totalAmount ??
          0
        ).toFixed(2),
        status: "CONFIRMED",
      })
      .returning();

    if (parsed.data.salesQuoteId) {
      const quoteLines = await tx
        .select()
        .from(salesQuoteLine)
        .where(eq(salesQuoteLine.salesQuoteId, parsed.data.salesQuoteId));
      if (quoteLines.length > 0) {
        await tx.insert(salesOrderLine).values(
          quoteLines.map((line) => ({
            salesOrderId: header.id,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPct: line.discountPct,
            taxRate: line.taxRate,
            retentionRate: line.retentionRate,
            lineTotal: line.lineTotal,
          })),
        );
      }
      await tx
        .update(salesQuote)
        .set({ status: "CONFIRMED", updatedAt: new Date() })
        .where(
          and(
            eq(salesQuote.id, parsed.data.salesQuoteId),
            eq(salesQuote.companyId, ctx.company.id),
          ),
        );
    } else if (parsed.data.lines?.length) {
      await tx.insert(salesOrderLine).values(
        parsed.data.lines.map((line) => ({
          salesOrderId: header.id,
          itemId: line.itemId || null,
          description: line.description,
          quantity: line.quantity.toFixed(3),
          unitPrice: line.unitPrice.toFixed(2),
          discountPct: (line.discountPct ?? 0).toFixed(3),
          taxRate: (line.taxRate ?? 0).toFixed(3),
          retentionRate: (line.retentionRate ?? 0).toFixed(3),
          lineTotal: computeDocumentTotals([line]).totalAmount.toFixed(2),
        })),
      );
    }

    await recordAudit(
      {
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        action: "salesOrder.create",
        entityName: "salesOrder",
        entityId: header.id,
        payload: {
          number: header.number,
          customerId: parsed.data.customerId,
          salesQuoteId: parsed.data.salesQuoteId || null,
          issueDate: parsed.data.issueDate,
          totalAmount: header.totalAmount,
          lineCount: parsed.data.lines?.length ?? null,
        },
      },
      tx,
    );

    return header;
  }));

  if (!result.ok) return handleRouteError(result.error, "salesOrder.create", "No se pudo crear el pedido de venta.");
  return NextResponse.json(result.value, { status: 201 });
}
