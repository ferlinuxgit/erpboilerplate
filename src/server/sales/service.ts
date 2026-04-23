import { and, eq } from "drizzle-orm";

import { customer, deliveryNote, documentSeries, invoice, salesOrder, salesQuote } from "@/db/schema";
import { db } from "@/lib/db";

type SeriesType = "SALES_QUOTE" | "SALES_ORDER" | "DELIVERY_NOTE" | "SALES_INVOICE";

async function reserveDocumentNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: string,
  fiscalYearId: string,
  type: SeriesType,
) {
  const [series] = await tx
    .select()
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.companyId, companyId),
        eq(documentSeries.fiscalYearId, fiscalYearId),
        eq(documentSeries.type, type),
      ),
    )
    .limit(1);

  if (!series) {
    throw new Error(`No existe serie para ${type}.`);
  }

  const reservedNumber = `${series.prefix}${String(series.nextNumber).padStart(6, "0")}`;
  await tx
    .update(documentSeries)
    .set({ nextNumber: series.nextNumber + 1 })
    .where(eq(documentSeries.id, series.id));

  return reservedNumber;
}

export async function convertQuoteToOrder(input: {
  companyId: string;
  fiscalYearId: string;
  quoteId: string;
}) {
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(salesQuote)
      .where(and(eq(salesQuote.id, input.quoteId), eq(salesQuote.companyId, input.companyId)))
      .limit(1);
    if (!quote) throw new Error("Presupuesto no encontrado.");

    const number = await reserveDocumentNumber(tx, input.companyId, input.fiscalYearId, "SALES_ORDER");
    const [created] = await tx
      .insert(salesOrder)
      .values({
        companyId: input.companyId,
        customerId: quote.customerId,
        salesQuoteId: quote.id,
        number,
        issueDate: new Date(),
        subtotal: quote.subtotal,
        taxAmount: quote.taxAmount,
        retentionAmount: quote.retentionAmount,
        totalAmount: quote.totalAmount,
        status: "CONFIRMED",
      })
      .returning();

    await tx
      .update(salesQuote)
      .set({ status: "CONFIRMED", updatedAt: new Date() })
      .where(eq(salesQuote.id, quote.id));

    return created;
  });
}

export async function convertOrderToDelivery(input: {
  companyId: string;
  fiscalYearId: string;
  salesOrderId: string;
}) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(salesOrder)
      .where(and(eq(salesOrder.id, input.salesOrderId), eq(salesOrder.companyId, input.companyId)))
      .limit(1);
    if (!order) throw new Error("Pedido no encontrado.");

    const number = await reserveDocumentNumber(tx, input.companyId, input.fiscalYearId, "DELIVERY_NOTE");
    const [created] = await tx
      .insert(deliveryNote)
      .values({
        companyId: input.companyId,
        customerId: order.customerId,
        salesOrderId: order.id,
        number,
        issuedAt: new Date(),
        status: "DELIVERED",
      })
      .returning();

    await tx
      .update(salesOrder)
      .set({ status: "DELIVERED", updatedAt: new Date() })
      .where(eq(salesOrder.id, order.id));

    return created;
  });
}

export async function convertDeliveryToInvoice(input: {
  companyId: string;
  fiscalYearId: string;
  deliveryNoteId: string;
}) {
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select()
      .from(deliveryNote)
      .where(and(eq(deliveryNote.id, input.deliveryNoteId), eq(deliveryNote.companyId, input.companyId)))
      .limit(1);
    if (!note) throw new Error("Albarán no encontrado.");

    const [order] = note.salesOrderId
      ? await tx
          .select()
          .from(salesOrder)
          .where(and(eq(salesOrder.id, note.salesOrderId), eq(salesOrder.companyId, input.companyId)))
          .limit(1)
      : [null];

    const number = await reserveDocumentNumber(tx, input.companyId, input.fiscalYearId, "SALES_INVOICE");
    const [created] = await tx
      .insert(invoice)
      .values({
        companyId: input.companyId,
        customerId: note.customerId,
        number,
        issueDate: new Date(),
        dueDate: null,
        totalAmount: (order?.totalAmount ?? "0").toString(),
        status: "SENT",
      })
      .returning();

    await tx
      .update(deliveryNote)
      .set({ status: "INVOICED", updatedAt: new Date() })
      .where(eq(deliveryNote.id, note.id));

    if (order) {
      await tx
        .update(salesOrder)
        .set({ status: "INVOICED", updatedAt: new Date() })
        .where(eq(salesOrder.id, order.id));
    }

    return created;
  });
}

export async function assertCustomerOwnership(companyId: string, customerId: string) {
  const [owned] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId)))
    .limit(1);
  return Boolean(owned);
}
