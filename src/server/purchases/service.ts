import { and, desc, eq } from "drizzle-orm";

import {
  goodsReceipt,
  partner,
  purchaseOrder,
  purchaseOrderLine,
  supplierInvoice,
  supplierPayment,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  assertSalesTransitionAllowed,
  getGoodsReceiptInvoiceTransition,
  getPurchaseOrderReceiptTransition,
  getSupplierInvoicePaymentTransition,
} from "@/lib/document-pipelines";
import { recordAudit } from "@/server/audit";
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
      .select({ id: goodsReceipt.id, purchaseOrderId: goodsReceipt.purchaseOrderId, receivedAt: goodsReceipt.receivedAt })
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
        supplierInvoiceId: supplierPayment.supplierInvoiceId,
        amount: supplierPayment.amount,
      })
      .from(supplierPayment)
      .where(eq(supplierPayment.companyId, companyId)),
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

type PurchasePayload = {
  supplierName: string;
  number?: string;
  fiscalYearId: string;
  lines?: Array<{ description: string; itemId?: string; quantity: number; unitPrice: number }>;
};

export async function createPurchaseOrder(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: PurchasePayload,
) {
  return db.transaction(async (tx) => {
    const existingSupplier = await tx
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.companyId, companyId), eq(partner.type, "SUPPLIER"), eq(partner.name, payload.supplierName)))
      .limit(1);

    const supplierId =
      existingSupplier[0]?.id ??
      (
        await tx
          .insert(partner)
          .values({ companyId, type: "SUPPLIER", name: payload.supplierName })
          .returning({ id: partner.id })
      )[0].id;

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
  payload: { number: string; status: string },
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(purchaseOrder)
      .set({ number: payload.number, status: payload.status })
      .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, id)))
      .returning({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status });

    if (!updated) return null;

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
