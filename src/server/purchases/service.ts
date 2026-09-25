import { and, desc, eq, inArray } from "drizzle-orm";

import {
  goodsReceipt,
  partner,
  purchaseOrder,
  purchaseOrderLine,
  supplierInvoice,
  supplierInvoicePayment,
  supplierPayment,
} from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import {
  assertSalesTransitionAllowed,
  getGoodsReceiptInvoiceTransition,
  getPurchaseOrderReceiptTransition,
  getSupplierInvoicePaymentTransition,
  assertManualPurchaseOrderTransition,
} from "@/lib/document-pipelines";
import { recordAudit } from "@/server/audit";
import { assertItemsBelongToCompany } from "@/server/inventory/ownership";
import { reserveSeriesNumber } from "@/server/documents/series";

export function assertPurchaseOrderCanReceive(input: { status: string; hasReceipt: boolean; hasLines: boolean }) {
  assertSalesTransitionAllowed(getPurchaseOrderReceiptTransition(input));
}

export function assertGoodsReceiptCanInvoice(input: { hasSupplierInvoice: boolean; hasLines: boolean }) {
  assertSalesTransitionAllowed(getGoodsReceiptInvoiceTransition(input));
}

export function assertSupplierInvoiceCanBePaid(input: { totalAmount: number; paidAmount: number }) {
  assertSalesTransitionAllowed(getSupplierInvoicePaymentTransition(input));
}

export async function listPurchaseOrders(companyId: string) {
  return db
    .select({
      id: purchaseOrder.id,
      number: purchaseOrder.number,
      status: purchaseOrder.status,
      supplierPartnerId: purchaseOrder.supplierPartnerId,
      supplierName: partner.name,
      createdAt: purchaseOrder.createdAt,
    })
    .from(purchaseOrder)
    .innerJoin(partner, eq(purchaseOrder.supplierPartnerId, partner.id))
    .where(eq(purchaseOrder.companyId, companyId))
    .orderBy(desc(purchaseOrder.createdAt));
}

export async function listPurchasePipeline(companyId: string) {
  const [orders, orderLines, receipts, invoices, payments] = await Promise.all([
    listPurchaseOrders(companyId),
    db
      .select({
        id: purchaseOrderLine.id,
        purchaseOrderId: purchaseOrderLine.purchaseOrderId,
        itemId: purchaseOrderLine.itemId,
        description: purchaseOrderLine.description,
        quantity: purchaseOrderLine.quantity,
        unitPrice: purchaseOrderLine.unitPrice,
      })
      .from(purchaseOrderLine)
      .innerJoin(purchaseOrder, eq(purchaseOrderLine.purchaseOrderId, purchaseOrder.id))
      .where(eq(purchaseOrder.companyId, companyId)),
    db
      .select({ id: goodsReceipt.id, number: goodsReceipt.number, purchaseOrderId: goodsReceipt.purchaseOrderId, warehouseId: goodsReceipt.warehouseId, supplierDocumentNumber: goodsReceipt.supplierDocumentNumber, notes: goodsReceipt.notes, receivedAt: goodsReceipt.receivedAt })
      .from(goodsReceipt)
      .innerJoin(purchaseOrder, eq(goodsReceipt.purchaseOrderId, purchaseOrder.id))
      .where(eq(purchaseOrder.companyId, companyId))
      .orderBy(desc(goodsReceipt.receivedAt)),
    db
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        supplierPartnerId: supplierInvoice.supplierPartnerId,
        purchaseOrderId: supplierInvoice.purchaseOrderId,
        goodsReceiptId: supplierInvoice.goodsReceiptId,
        issueDate: supplierInvoice.issueDate,
        totalAmount: supplierInvoice.totalAmount,
      })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.origin, "PURCHASE"))),
    db
      .select({
        id: supplierPayment.id,
        supplierInvoiceId: supplierInvoicePayment.supplierInvoiceId,
        amount: supplierPayment.amount,
      })
      .from(supplierInvoicePayment)
      .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
      .where(eq(supplierInvoicePayment.companyId, companyId)),
  ]);

  return { orders, orderLines, receipts, invoices, payments };
}

export async function getPurchaseOrder(companyId: string, id: string) {
  const rows = await db
    .select({
      id: purchaseOrder.id,
      number: purchaseOrder.number,
      status: purchaseOrder.status,
      supplierName: partner.name,
    })
    .from(purchaseOrder)
    .innerJoin(partner, eq(purchaseOrder.supplierPartnerId, partner.id))
    .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, id)))
    .limit(1);

  return rows[0] ?? null;
}

type PurchaseSupplierRef = {
  /** Proveedor elegido en el buscador (camino normal de la interfaz). */
  supplierPartnerId?: string;
  /** Compatibilidad API: nombre exacto de un proveedor existente. Nunca crea uno nuevo. */
  supplierName?: string;
};

type PurchasePayload = PurchaseSupplierRef & {
  number?: string;
  fiscalYearId: string;
  lines?: Array<{ description: string; itemId?: string; quantity: number; unitPrice: number }>;
};

export const PURCHASE_SUPPLIER_NOT_FOUND = "PURCHASE_SUPPLIER_NOT_FOUND";

/**
 * Proveedor de un pedido: debe existir. Escribir un nombre ya no da de alta proveedores
 * (evita duplicados como "Suministros Norte" y "Suministros Norte S.L."): se crean de
 * forma explícita desde el buscador o la ficha de proveedores.
 */
async function resolvePurchaseSupplier(tx: DbClient, companyId: string, ref: PurchaseSupplierRef) {
  const supplierPartnerId = ref.supplierPartnerId?.trim();
  const supplierName = ref.supplierName?.trim();
  if (!supplierPartnerId && !supplierName) throw new Error(PURCHASE_SUPPLIER_NOT_FOUND);
  const [supplier] = await tx
    .select({ id: partner.id })
    .from(partner)
    .where(and(
      eq(partner.companyId, companyId),
      inArray(partner.type, ["SUPPLIER", "BOTH"]),
      supplierPartnerId ? eq(partner.id, supplierPartnerId) : eq(partner.name, supplierName ?? ""),
    ))
    .limit(1);
  if (!supplier) throw new Error(PURCHASE_SUPPLIER_NOT_FOUND);
  return supplier.id;
}

export async function createPurchaseOrder(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: PurchasePayload,
) {
  return db.transaction(async (tx) => {
    const supplierId = await resolvePurchaseSupplier(tx, companyId, payload);

    const [createdOrder] = await tx
      .insert(purchaseOrder)
      .values({
        companyId,
        supplierPartnerId: supplierId,
        number:
          payload.number?.trim() ||
          (await reserveSeriesNumber(tx, {
            companyId,
            fiscalYearId: payload.fiscalYearId,
            type: "PURCHASE_ORDER",
          })),
      })
      .returning({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status });

    if (payload.lines && payload.lines.length > 0) {
      await assertItemsBelongToCompany(tx, companyId, payload.lines.map((line) => line.itemId));
      await tx.insert(purchaseOrderLine).values(
        payload.lines.map((line) => ({
          purchaseOrderId: createdOrder.id,
          itemId: line.itemId || null,
          description: line.description,
          quantity: line.quantity.toFixed(3),
          unitPrice: line.unitPrice.toFixed(2),
          lineTotal: (line.quantity * line.unitPrice).toFixed(2),
        })),
      );
    }

    await recordAudit(
      {
        tenantId,
        companyId,
        actorUserId,
        action: "purchase.create",
        entityName: "purchaseOrder",
        entityId: createdOrder.id,
        payload,
      },
      tx,
    );

    return createdOrder;
  });
}

export async function updatePurchaseOrder(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  id: string,
  payload: PurchaseSupplierRef & { number: string; status: string; lines: Array<{ description: string; itemId?: string; quantity: number; unitPrice: number }> },
) {
  return db.transaction(async (tx) => {
    const [dependentReceipt, dependentInvoice] = await Promise.all([
      tx
        .select({ id: goodsReceipt.id })
        .from(goodsReceipt)
        .where(eq(goodsReceipt.purchaseOrderId, id))
        .limit(1),
      tx
        .select({ id: supplierInvoice.id })
        .from(supplierInvoice)
        .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.purchaseOrderId, id)))
        .limit(1),
    ]);
    if (dependentReceipt[0] || dependentInvoice[0]) {
      throw new Error("PURCHASE_ORDER_LOCKED");
    }

    const [current] = await tx
      .select({ status: purchaseOrder.status })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, id)))
      .for("update")
      .limit(1);
    if (!current) return null;
    assertManualPurchaseOrderTransition(current.status, payload.status);

    const supplierId = await resolvePurchaseSupplier(tx, companyId, payload);

    const [updated] = await tx
      .update(purchaseOrder)
      .set({ number: payload.number, status: payload.status, supplierPartnerId: supplierId })
      .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, id)))
      .returning({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status });

    if (!updated) return null;

    await assertItemsBelongToCompany(tx, companyId, payload.lines.map((line) => line.itemId));
    await tx.delete(purchaseOrderLine).where(eq(purchaseOrderLine.purchaseOrderId, id));
    await tx.insert(purchaseOrderLine).values(payload.lines.map((line) => ({
      purchaseOrderId: id,
      itemId: line.itemId || null,
      description: line.description,
      quantity: line.quantity.toFixed(3),
      unitPrice: line.unitPrice.toFixed(2),
      lineTotal: (line.quantity * line.unitPrice).toFixed(2),
    })));

    await recordAudit(
      {
        tenantId,
        companyId,
        actorUserId,
        action: "purchase.update",
        entityName: "purchaseOrder",
        entityId: id,
        payload,
      },
      tx,
    );

    return updated;
  });
}

export async function deletePurchaseOrder(companyId: string, tenantId: string, actorUserId: string, id: string) {
  return db.transaction(async (tx) => {
    const [dependentReceipt, dependentInvoice] = await Promise.all([
      tx
        .select({ id: goodsReceipt.id })
        .from(goodsReceipt)
        .where(eq(goodsReceipt.purchaseOrderId, id))
        .limit(1),
      tx
        .select({ id: supplierInvoice.id })
        .from(supplierInvoice)
        .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.purchaseOrderId, id)))
        .limit(1),
    ]);
    if (dependentReceipt[0] || dependentInvoice[0]) {
      throw new Error("PURCHASE_ORDER_HAS_DEPENDENCIES");
    }

    const [deleted] = await tx
      .delete(purchaseOrder)
      .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, id)))
      .returning({ id: purchaseOrder.id });

    if (!deleted) return false;

    await recordAudit(
      {
        tenantId,
        companyId,
        actorUserId,
        action: "purchase.delete",
        entityName: "purchaseOrder",
        entityId: id,
      },
      tx,
    );

    return true;
  });
}
