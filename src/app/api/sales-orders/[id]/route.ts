import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { customer, salesOrder, salesOrderLine } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError, handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { recordAudit } from "@/server/audit";
import { rejectForeignItems } from "@/server/inventory/ownership";
import { cancelSalesOrder, orderChangeBlocker } from "@/server/sales/service";
import { computeDocumentTotals } from "@/server/taxation/engine";

const lineSchema = z.object({
  description: z.string().trim().min(1, "Cada línea necesita un concepto."),
  itemId: z.string().trim().optional().or(z.literal("")),
  quantity: z.number().positive("La cantidad debe ser mayor que 0."),
  unitPrice: z.number().nonnegative("El precio no puede ser negativo."),
  taxRate: z.number().nonnegative().optional(),
  retentionRate: z.number().nonnegative().optional(),
  discountPct: z.number().min(0).max(100).optional(),
});
const payloadSchema = z.object({
  customerId: z.string().trim().min(1, "Elige el cliente del pedido."),
  issueDate: z.string().trim().min(1, "Indica la fecha del pedido."),
  number: z.string().trim().optional().or(z.literal("")),
  lines: z.array(lineSchema).min(1, "Añade al menos una línea."),
});

/** Edita un pedido mientras no tenga albaranes ni factura. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Revisa cliente, fecha y líneas." }, { status: 400 });
  const issueDate = new Date(parsed.data.issueDate);
  if (Number.isNaN(issueDate.getTime())) return NextResponse.json({ message: "La fecha del pedido no es válida." }, { status: 400 });
  const { id } = await params;

  const [ownedCustomer] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, parsed.data.customerId), eq(customer.companyId, ctx.company.id)))
    .limit(1);
  if (!ownedCustomer) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
  const foreignItems = await rejectForeignItems(db, ctx.company.id, parsed.data.lines);
  if (foreignItems) return foreignItems;
  const totals = computeDocumentTotals(parsed.data.lines);

  try {
    const updated = await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status })
        .from(salesOrder)
        .where(and(eq(salesOrder.id, id), eq(salesOrder.companyId, ctx.company.id)))
        .for("update")
        .limit(1);
      if (!order) throw new HttpError(404, "Pedido no encontrado.");
      const blocker = await orderChangeBlocker(tx, ctx.company.id, order, "edit");
      if (blocker) throw new HttpError(409, blocker);
      await tx
        .update(salesOrder)
        .set({
          customerId: parsed.data.customerId,
          issueDate,
          subtotal: totals.subtotal.toFixed(2),
          taxAmount: totals.taxAmount.toFixed(2),
          retentionAmount: totals.retentionAmount.toFixed(2),
          totalAmount: totals.totalAmount.toFixed(2),
          updatedAt: new Date(),
        })
        .where(and(eq(salesOrder.id, id), eq(salesOrder.companyId, ctx.company.id)));
      await tx.delete(salesOrderLine).where(eq(salesOrderLine.salesOrderId, id));
      await tx.insert(salesOrderLine).values(parsed.data.lines.map((line) => ({
        salesOrderId: id,
        itemId: line.itemId || null,
        description: line.description,
        quantity: line.quantity.toFixed(3),
        unitPrice: line.unitPrice.toFixed(2),
        discountPct: (line.discountPct ?? 0).toFixed(3),
        taxRate: (line.taxRate ?? 0).toFixed(3),
        retentionRate: (line.retentionRate ?? 0).toFixed(3),
        lineTotal: computeDocumentTotals([line]).totalAmount.toFixed(2),
      })));
      await recordAudit(
        { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "salesOrder.update", entityName: "salesOrder", entityId: id, payload: { number: order.number, totalAmount: totals.totalAmount, lineCount: parsed.data.lines.length } },
        tx,
      );
      return { id, number: order.number };
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "salesOrder.update", "No se pudo guardar el pedido.");
  }
}

/** Anula un pedido sin albaranes ni factura. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const cancelled = await cancelSalesOrder({ tenantId: actor.context.tenant.id, companyId: actor.context.company.id, actorUserId: actor.actorUserId, salesOrderId: id });
    return NextResponse.json(cancelled);
  } catch (error) {
    return handleRouteError(error, "salesOrder.cancel", "No se pudo anular el pedido.");
  }
}
