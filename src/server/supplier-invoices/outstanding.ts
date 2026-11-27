import { and, eq, inArray, sql } from "drizzle-orm";

import { goodsReceipt, purchaseOrder, supplierCreditApplication, supplierInvoice, supplierInvoicePayment } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { toCents } from "@/server/accounting/money";

/*
 * «Pendiente de pago» de una factura recibida = total − pagos − abonos compensados.
 *
 * Única definición para pagos a proveedor, remesas SEPA, tesorería (mesa de conciliación y
 * previsión), ficha del proveedor, listado de gastos y panel. Las expresiones SQL son subconsultas
 * correlacionadas con `supplier_invoice`: sirven en cualquier consulta que la tenga en el FROM.
 * La regla pura equivalente es `supplierOutstandingCents` (document-rules.ts).
 */

/** Pagos aplicados a la factura. */
export const supplierInvoicePaidSql = sql<string>`coalesce((select sum(${supplierInvoicePayment.amountApplied}) from ${supplierInvoicePayment} where ${supplierInvoicePayment.supplierInvoiceId} = ${supplierInvoice.id}), 0)`;

/** Abonos del proveedor compensados contra la factura. */
export const supplierInvoiceCreditedSql = sql<string>`coalesce((select sum(${supplierCreditApplication.amount}) from ${supplierCreditApplication} where ${supplierCreditApplication.supplierInvoiceId} = ${supplierInvoice.id}), 0)`;

/** Pagos + abonos compensados. */
export const supplierInvoiceSettledSql = sql<string>`(${supplierInvoicePaidSql} + ${supplierInvoiceCreditedSql})`;

/** Pendiente de pago (0 en anuladas y abonos). */
export const supplierInvoiceOutstandingSql = sql<string>`case when ${supplierInvoice.status} = 'VOID' then 0 else greatest(${supplierInvoice.totalAmount} - ${supplierInvoiceSettledSql}, 0) end`;

export type SupplierInvoiceSettlement = { paidCents: number; creditedCents: number };

/** Pagado y compensado (en céntimos) de un conjunto de facturas. Las que no tienen nada no aparecen. */
export async function loadSupplierInvoiceSettlements(client: DbClient, companyId: string, supplierInvoiceIds?: string[]) {
  const result = new Map<string, SupplierInvoiceSettlement>();
  if (supplierInvoiceIds && supplierInvoiceIds.length === 0) return result;
  const [paidRows, creditRows] = await Promise.all([
    client
      .select({ id: supplierInvoicePayment.supplierInvoiceId, amount: sql<string>`sum(${supplierInvoicePayment.amountApplied})` })
      .from(supplierInvoicePayment)
      .where(and(eq(supplierInvoicePayment.companyId, companyId), supplierInvoiceIds ? inArray(supplierInvoicePayment.supplierInvoiceId, supplierInvoiceIds) : undefined))
      .groupBy(supplierInvoicePayment.supplierInvoiceId),
    client
      .select({ id: supplierCreditApplication.supplierInvoiceId, amount: sql<string>`sum(${supplierCreditApplication.amount})` })
      .from(supplierCreditApplication)
      .where(and(
        eq(supplierCreditApplication.companyId, companyId),
        sql`${supplierCreditApplication.supplierInvoiceId} is not null`,
        supplierInvoiceIds ? inArray(supplierCreditApplication.supplierInvoiceId, supplierInvoiceIds) : undefined,
      ))
      .groupBy(supplierCreditApplication.supplierInvoiceId),
  ]);
  const entry = (id: string) => {
    let value = result.get(id);
    if (!value) {
      value = { paidCents: 0, creditedCents: 0 };
      result.set(id, value);
    }
    return value;
  };
  for (const row of paidRows) entry(row.id).paidCents = toCents(row.amount);
  for (const row of creditRows) if (row.id) entry(row.id).creditedCents = toCents(row.amount);
  return result;
}

export async function loadSupplierInvoiceSettlement(client: DbClient, companyId: string, supplierInvoiceId: string): Promise<SupplierInvoiceSettlement> {
  return (await loadSupplierInvoiceSettlements(client, companyId, [supplierInvoiceId])).get(supplierInvoiceId) ?? { paidCents: 0, creditedCents: 0 };
}

/**
 * Estado del pedido de compra según el cobro de sus facturas (función pura):
 * todas las facturas activas pagadas → PAID; si estaba PAID y ya no lo está → INVOICED (o
 * RECEIVED/APPROVED si no queda ninguna factura activa). En otro caso no cambia.
 */
export function nextPurchaseOrderStatus(input: {
  currentStatus: string;
  invoices: Array<{ status: string; paymentStatus: string }>;
  hasGoodsReceipt: boolean;
}) {
  const active = input.invoices.filter((row) => row.status !== "VOID");
  const allPaid = active.length > 0 && active.every((row) => row.paymentStatus === "PAID");
  if (allPaid) return "PAID";
  if (input.currentStatus !== "PAID") return input.currentStatus;
  if (active.length > 0) return "INVOICED";
  return input.hasGoodsReceipt ? "RECEIVED" : "APPROVED";
}

/** Recalcula el estado del pedido de compra tras registrar o deshacer un pago de sus facturas. */
export async function syncPurchaseOrderPaymentStatus(client: DbClient, companyId: string, purchaseOrderId: string) {
  const [order] = await client
    .select({ id: purchaseOrder.id, status: purchaseOrder.status })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, purchaseOrderId)))
    .limit(1);
  if (!order) return null;
  const [invoices, receipts] = await Promise.all([
    client
      .select({ status: supplierInvoice.status, paymentStatus: supplierInvoice.paymentStatus })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.purchaseOrderId, purchaseOrderId))),
    client
      .select({ id: goodsReceipt.id })
      .from(goodsReceipt)
      .where(and(eq(goodsReceipt.companyId, companyId), eq(goodsReceipt.purchaseOrderId, purchaseOrderId)))
      .limit(1),
  ]);
  const next = nextPurchaseOrderStatus({ currentStatus: order.status, invoices, hasGoodsReceipt: receipts.length > 0 });
  if (next !== order.status) {
    await client
      .update(purchaseOrder)
      .set({ status: next })
      .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, purchaseOrderId)));
  }
  return next;
}

