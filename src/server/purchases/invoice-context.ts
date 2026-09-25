import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { goodsReceipt, goodsReceiptLine, item, partner, purchaseOrder, purchaseOrderLine, supplierInvoice, supplierInvoiceGoodsReceipt, tax } from "@/db/schema";
import { db } from "@/lib/db";
import type { OrderLineRef, ReceiptLineRef } from "@/lib/purchase-invoice";

export type PurchaseInvoiceReceipt = {
  id: string;
  number: string;
  receivedAt: Date;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

/**
 * Datos para facturar las recepciones de un pedido: recepciones (con su factura si ya la
 * tienen), líneas recibidas y del pedido, IVA de cada artículo y el IVA por defecto.
 */
export async function getPurchaseInvoiceContext(companyId: string, purchaseOrderId: string) {
  const [order] = await db
    .select({ id: purchaseOrder.id, supplierPartnerId: purchaseOrder.supplierPartnerId, paymentTermsDays: partner.paymentTermsDays })
    .from(purchaseOrder)
    .innerJoin(partner, eq(partner.id, purchaseOrder.supplierPartnerId))
    .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.id, purchaseOrderId)))
    .limit(1);
  if (!order) return null;

  const [receiptRows, orderLineRows, receiptLineRows, defaultTax] = await Promise.all([
    db
      .select({ id: goodsReceipt.id, number: goodsReceipt.number, receivedAt: goodsReceipt.receivedAt })
      .from(goodsReceipt)
      .where(and(eq(goodsReceipt.companyId, companyId), eq(goodsReceipt.purchaseOrderId, purchaseOrderId)))
      .orderBy(asc(goodsReceipt.receivedAt), asc(goodsReceipt.id)),
    db
      .select({ id: purchaseOrderLine.id, itemId: purchaseOrderLine.itemId, description: purchaseOrderLine.description, quantity: purchaseOrderLine.quantity, unitPrice: purchaseOrderLine.unitPrice })
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLine.id)),
    db
      .select({
        id: goodsReceiptLine.id,
        goodsReceiptId: goodsReceiptLine.goodsReceiptId,
        goodsReceiptNumber: goodsReceipt.number,
        purchaseOrderLineId: goodsReceiptLine.purchaseOrderLineId,
        itemId: goodsReceiptLine.itemId,
        itemName: item.name,
        quantity: goodsReceiptLine.quantity,
      })
      .from(goodsReceiptLine)
      .innerJoin(goodsReceipt, eq(goodsReceipt.id, goodsReceiptLine.goodsReceiptId))
      .leftJoin(item, eq(item.id, goodsReceiptLine.itemId))
      .where(and(eq(goodsReceipt.companyId, companyId), eq(goodsReceipt.purchaseOrderId, purchaseOrderId)))
      .orderBy(asc(goodsReceipt.receivedAt), asc(goodsReceiptLine.id)),
    db
      .select({ rate: tax.rate })
      .from(tax)
      .where(and(eq(tax.companyId, companyId), eq(tax.isDefault, true), eq(tax.kind, "VAT"), eq(tax.isActive, true)))
      .limit(1),
  ]);

  const receiptIds = receiptRows.map((receipt) => receipt.id);
  const [linked, legacy] = receiptIds.length
    ? await Promise.all([
        db
          .select({ goodsReceiptId: supplierInvoiceGoodsReceipt.goodsReceiptId, invoiceId: supplierInvoice.id, invoiceNumber: supplierInvoice.number })
          .from(supplierInvoiceGoodsReceipt)
          .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoiceGoodsReceipt.supplierInvoiceId))
          .where(and(eq(supplierInvoiceGoodsReceipt.companyId, companyId), inArray(supplierInvoiceGoodsReceipt.goodsReceiptId, receiptIds), ne(supplierInvoice.status, "VOID"))),
        db
          .select({ goodsReceiptId: supplierInvoice.goodsReceiptId, invoiceId: supplierInvoice.id, invoiceNumber: supplierInvoice.number })
          .from(supplierInvoice)
          .where(and(eq(supplierInvoice.companyId, companyId), inArray(supplierInvoice.goodsReceiptId, receiptIds), ne(supplierInvoice.status, "VOID"))),
      ])
    : [[], []];
  const invoiceByReceipt = new Map<string, { invoiceId: string; invoiceNumber: string }>();
  for (const row of [...linked, ...legacy]) {
    if (row.goodsReceiptId && !invoiceByReceipt.has(row.goodsReceiptId)) invoiceByReceipt.set(row.goodsReceiptId, { invoiceId: row.invoiceId, invoiceNumber: row.invoiceNumber });
  }

  const itemIds = [...new Set(receiptLineRows.flatMap((line) => (line.itemId ? [line.itemId] : [])))];
  const itemTaxRows = itemIds.length
    ? await db
        .select({ itemId: item.id, rate: tax.rate })
        .from(item)
        .innerJoin(tax, eq(tax.id, item.defaultTaxId))
        .where(and(eq(item.companyId, companyId), inArray(item.id, itemIds)))
    : [];

  const receipts: PurchaseInvoiceReceipt[] = receiptRows.map((receipt) => ({
    ...receipt,
    invoiceId: invoiceByReceipt.get(receipt.id)?.invoiceId ?? null,
    invoiceNumber: invoiceByReceipt.get(receipt.id)?.invoiceNumber ?? null,
  }));
  const orderLines: OrderLineRef[] = orderLineRows.map((line) => ({ ...line, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }));
  const receiptLines: ReceiptLineRef[] = receiptLineRows.map((line) => ({ ...line, quantity: Number(line.quantity) }));
  return {
    purchaseOrderId,
    supplierPartnerId: order.supplierPartnerId,
    paymentTermsDays: order.paymentTermsDays,
    receipts,
    orderLines,
    receiptLines,
    itemTaxRates: itemTaxRows.map((row): [string, number] => [row.itemId, Number(row.rate)]),
    fallbackTaxRate: defaultTax[0] ? Number(defaultTax[0].rate) : null,
  };
}

export type PurchaseInvoiceContext = NonNullable<Awaited<ReturnType<typeof getPurchaseInvoiceContext>>>;
