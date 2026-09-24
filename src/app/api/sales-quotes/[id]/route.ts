import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { customer, salesQuote, salesQuoteLine } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { HttpError, handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { settle } from "@/lib/settle";
import { recordAudit } from "@/server/audit";
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
const payloadSchema = z.object({
  customerId: z.string().trim().min(1),
  number: z.string().trim().min(1),
  issueDate: z.string().trim().min(1),
  validUntil: z.string().trim().optional().or(z.literal("")),
  lines: z.array(lineSchema).min(1),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getUserSession();
  if (!session?.user)
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await requireContext();
  if (!can(ctx.membership.role, "invoice.create"))
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success)
    return NextResponse.json(
      { message: "Revisa cliente, fechas, número y líneas." },
      { status: 400 },
    );
  const { id } = await params;
  const [existing] = await db
    .select({ id: salesQuote.id, status: salesQuote.status })
    .from(salesQuote)
    .where(and(eq(salesQuote.id, id), eq(salesQuote.companyId, ctx.company.id)))
    .limit(1);
  if (!existing)
    return NextResponse.json(
      { message: "Presupuesto no encontrado." },
      { status: 404 },
    );
  if (existing.status !== "DRAFT")
    return NextResponse.json(
      { message: "Solo se pueden editar presupuestos en borrador." },
      { status: 409 },
    );
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
  const foreignItems = await rejectForeignItems(db, ctx.company.id, parsed.data.lines);
  if (foreignItems) return foreignItems;
  const totals = computeDocumentTotals(parsed.data.lines);
  const result = await settle(db.transaction(async (tx) => {
    const [updatedQuote] = await tx
      .update(salesQuote)
      .set({
        customerId: parsed.data.customerId,
        number: parsed.data.number,
        issueDate: new Date(parsed.data.issueDate),
        validUntil: parsed.data.validUntil
          ? new Date(parsed.data.validUntil)
          : null,
        subtotal: totals.subtotal.toFixed(2),
        taxAmount: totals.taxAmount.toFixed(2),
        retentionAmount: totals.retentionAmount.toFixed(2),
        totalAmount: totals.totalAmount.toFixed(2),
        updatedAt: new Date(),
      })
      .where(
        and(eq(salesQuote.id, id), eq(salesQuote.companyId, ctx.company.id), eq(salesQuote.status, "DRAFT")),
      )
      .returning({ id: salesQuote.id, number: salesQuote.number, totalAmount: salesQuote.totalAmount });
    if (!updatedQuote) throw new HttpError(409, "Solo se pueden editar presupuestos en borrador.");
    await tx.delete(salesQuoteLine).where(eq(salesQuoteLine.salesQuoteId, id));
    await tx.insert(salesQuoteLine).values(
      parsed.data.lines.map((line) => ({
        salesQuoteId: id,
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
    await recordAudit(
      {
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        action: "salesQuote.update",
        entityName: "salesQuote",
        entityId: id,
        payload: {
          number: updatedQuote.number,
          customerId: parsed.data.customerId,
          issueDate: parsed.data.issueDate,
          validUntil: parsed.data.validUntil || null,
          totalAmount: updatedQuote.totalAmount,
          lineCount: parsed.data.lines.length,
        },
      },
      tx,
    );
  }));
  if (!result.ok) return handleRouteError(result.error, "salesQuote.update", "No se pudo actualizar el presupuesto.");
  return NextResponse.json({ id });
}
