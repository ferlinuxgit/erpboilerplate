import { and, eq } from "drizzle-orm";

import {
  auditLog,
  customer,
  deliveryNote,
  deliveryNoteLine,
  documentSeries,
  invoice,
  invoiceLine,
  salesOrder,
  salesOrderLine,
  salesQuote,
  salesQuoteLine,
  stockMovement,
  warehouse,
} from "@/db/schema";
import { db } from "@/lib/db";
import { formatSeriesNumber } from "@/lib/document-series-format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { postSalesInvoice } from "@/server/accounting/auto-post";
import { recordAudit } from "@/server/audit";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { refreshStockLocation } from "@/server/inventory/stock-location";
import { buildInvoiceLineInsertValues } from "@/server/invoices/line-values";
import {
  assertSalesTransitionAllowed,
  getDeliveryNoteTransition,
  getSalesOrderTransition,
  getSalesQuoteTransition,
  type SalesDocumentStatus,
} from "@/lib/document-pipelines";

type SeriesType = "SALES_QUOTE" | "SALES_ORDER" | "DELIVERY_NOTE" | "SALES_INVOICE";

export function assertQuoteCanConvert(status: SalesDocumentStatus) {
  assertSalesTransitionAllowed(getSalesQuoteTransition(status));
}

export function assertOrderCanConvertToDelivery(status: SalesDocumentStatus) {
  assertSalesTransitionAllowed(getSalesOrderTransition(status));
}

export function assertDeliveryCanConvertToInvoice(status: SalesDocumentStatus) {
  assertSalesTransitionAllowed(getDeliveryNoteTransition(status));
}

async function reserveDocumentNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: string,
  fiscalYearId: string,
  type: SeriesType,
  referenceDate?: Date | string | null,
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

  const reservedNumber = formatSeriesNumber({
    format: series.format,
    nextNumber: series.nextNumber,
    prefix: series.prefix,
    referenceDate,
  });
  await tx
    .update(documentSeries)
    .set({ nextNumber: series.nextNumber + 1 })
    .where(eq(documentSeries.id, series.id));

  return reservedNumber;
}

function finiteMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickStoredOrderTotals(
  order: Record<string, unknown>,
  fallback: { subtotal: number; taxAmount: number; retentionAmount: number; totalAmount: number },
) {
  const subtotal = finiteMoney(order.subtotal);
  const taxAmount = finiteMoney(order.taxAmount);
  const retentionAmount = finiteMoney(order.retentionAmount);
  const totalAmount = finiteMoney(order.totalAmount);
  if (subtotal === null || taxAmount === null || retentionAmount === null || totalAmount === null) return fallback;
  return { subtotal, taxAmount, retentionAmount, totalAmount };
}

function formatMoney(value: number) {
  return value.toFixed(2);
}

function sameQuantity(left: unknown, right: unknown) {
  const leftNumber = finiteMoney(left);
  const rightNumber = finiteMoney(right);
  return leftNumber !== null && rightNumber !== null && Math.abs(leftNumber - rightNumber) < 0.0005;
}

function deliveryCoversWholeOrder(deliveryLines: Array<Record<string, unknown>>, orderLines: Array<Record<string, unknown>>) {
  if (deliveryLines.length !== orderLines.length) return false;

  const remainingDeliveryLines = [...deliveryLines];
  return orderLines.every((orderLine) => {
    const index = remainingDeliveryLines.findIndex(
      (deliveryLine) => deliveryLine.itemId === orderLine.itemId && sameQuantity(deliveryLine.quantity, orderLine.quantity),
    );
    if (index === -1) return false;
    remainingDeliveryLines.splice(index, 1);
    return true;
  });
}

function findSourceOrderLine(
  deliveryLine: Record<string, unknown>,
  availableOrderLines: Array<Record<string, unknown> & { __matched?: boolean }>,
) {
  const unmatchedLines = availableOrderLines.filter((line) => !line.__matched);
  const itemId = deliveryLine.itemId;
  const matches = itemId ? unmatchedLines.filter((line) => line.itemId === itemId) : unmatchedLines;
  const deliveryDescription = String(deliveryLine.description ?? "").trim();
  const descriptionMatches = deliveryDescription
    ? matches.filter((line) => String(line.description ?? "").trim() === deliveryDescription)
    : [];
  const candidates = descriptionMatches.length > 0 ? descriptionMatches : matches;
  if (candidates.length !== 1) return null;

  const sourceLine = candidates[0];
  sourceLine.__matched = true;
  return sourceLine;
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
    assertQuoteCanConvert(quote.status as SalesDocumentStatus);

    const issueDate = new Date();
    const number = await reserveDocumentNumber(tx, input.companyId, input.fiscalYearId, "SALES_ORDER", issueDate);
    const [created] = await tx
      .insert(salesOrder)
      .values({
        companyId: input.companyId,
        customerId: quote.customerId,
        salesQuoteId: quote.id,
        number,
        issueDate,
        subtotal: quote.subtotal,
        taxAmount: quote.taxAmount,
        retentionAmount: quote.retentionAmount,
        totalAmount: quote.totalAmount,
        status: "CONFIRMED",
      })
      .returning();

    const quoteLines = await tx.select().from(salesQuoteLine).where(eq(salesQuoteLine.salesQuoteId, quote.id));
    if (quoteLines.length > 0) {
      await tx.insert(salesOrderLine).values(
        quoteLines.map((line) => ({
          salesOrderId: created.id,
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
      .where(eq(salesQuote.id, quote.id));

    return created;
  });
}

export async function convertOrderToDelivery(input: {
  tenantId?: string;
  companyId: string;
  actorUserId?: string;
  fiscalYearId: string;
  salesOrderId: string;
  warehouseId?: string | null;
}) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(salesOrder)
      .where(and(eq(salesOrder.id, input.salesOrderId), eq(salesOrder.companyId, input.companyId)))
      .limit(1);
    if (!order) throw new Error("Pedido no encontrado.");
    assertSalesTransitionAllowed(getSalesOrderTransition(order.status as SalesDocumentStatus));

    const [ownedWarehouse] = input.warehouseId
      ? await tx
          .select({ id: warehouse.id })
          .from(warehouse)
          .where(and(eq(warehouse.id, input.warehouseId), eq(warehouse.companyId, input.companyId)))
          .limit(1)
      : await tx.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.companyId, input.companyId)).limit(1);
    if (!ownedWarehouse) throw new Error("Almacén no encontrado.");

    const issuedAt = new Date();
    const number = await reserveDocumentNumber(tx, input.companyId, input.fiscalYearId, "DELIVERY_NOTE", issuedAt);
    const [created] = await tx
      .insert(deliveryNote)
      .values({
        companyId: input.companyId,
        customerId: order.customerId,
        salesOrderId: order.id,
        number,
        issuedAt,
        status: "DELIVERED",
      })
      .returning();

    const orderLines = await tx.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, order.id));
    if (orderLines.length === 0) throw new Error("No se puede crear el albarán sin líneas del pedido de origen.");

    const insertedLines = await tx
      .insert(deliveryNoteLine)
      .values(
        orderLines.map((line) => ({
          deliveryNoteId: created.id,
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity,
        })),
      )
      .returning();

    for (const line of insertedLines) {
      if (!line.itemId) continue;
      await tx.insert(stockMovement).values({
        companyId: input.companyId,
        itemId: line.itemId,
        warehouseId: ownedWarehouse.id,
        movementType: "OUT",
        quantity: line.quantity,
        movedAt: new Date(),
      });
      await refreshStockLocation({ companyId: input.companyId, itemId: line.itemId, warehouseId: ownedWarehouse.id }, tx);
    }

    await tx
      .update(salesOrder)
      .set({ status: "DELIVERED", updatedAt: new Date() })
      .where(eq(salesOrder.id, order.id));

    if (input.tenantId && input.actorUserId) {
      await recordAudit(
        {
          tenantId: input.tenantId,
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          action: "sales.delivery.create",
          entityName: "delivery_note",
          entityId: created.id,
          payload: {
            salesOrderId: order.id,
            warehouseId: ownedWarehouse.id,
            number: created.number,
          },
        },
        tx,
      );
    }

    return created;
  });
}

export async function convertDeliveryToInvoice(input: {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  fiscalYearId: string;
  deliveryNoteId: string;
}) {
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select()
      .from(deliveryNote)
      .where(and(eq(deliveryNote.id, input.deliveryNoteId), eq(deliveryNote.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!note) throw new Error("Albarán no encontrado.");
    const deliveryTransition = getDeliveryNoteTransition(note.status as SalesDocumentStatus);
    if (deliveryTransition.allowed === false) {
      if (note.status === "INVOICED" || note.status === "PAID") {
        const invoiceAuditRows = await tx
          .select({ entityId: auditLog.entityId, payload: auditLog.payload })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.tenantId, input.tenantId),
              eq(auditLog.companyId, input.companyId),
              eq(auditLog.action, "sales.delivery.invoice"),
              eq(auditLog.entityName, "invoice"),
            ),
          );
        const linkedAudit = invoiceAuditRows.find((row) => {
          if (!row.payload) return false;
          try {
            const payload = JSON.parse(row.payload) as { deliveryNoteId?: unknown };
            return payload.deliveryNoteId === note.id;
          } catch {
            return false;
          }
        });
        if (linkedAudit) {
          const [existingInvoice] = await tx
            .select({ id: invoice.id, number: invoice.number })
            .from(invoice)
            .where(and(eq(invoice.id, linkedAudit.entityId), eq(invoice.companyId, input.companyId)))
            .limit(1);
          if (existingInvoice) return existingInvoice;
        }
      }
      assertSalesTransitionAllowed(deliveryTransition);
    }

    const [order] = note.salesOrderId
      ? await tx
          .select()
          .from(salesOrder)
          .where(and(eq(salesOrder.id, note.salesOrderId), eq(salesOrder.companyId, input.companyId)))
          .limit(1)
      : [null];

    if (!order) throw new Error("No se puede facturar un albarán sin pedido de origen.");

    const deliveryLines = await tx.select().from(deliveryNoteLine).where(eq(deliveryNoteLine.deliveryNoteId, note.id));
    if (deliveryLines.length === 0) throw new Error("No se puede crear la factura sin líneas del albarán de origen.");

    const orderLines = await tx.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, order.id));
    if (orderLines.length === 0) throw new Error("No se puede crear la factura sin líneas del pedido de origen.");

    const availableOrderLines = orderLines.map((line) => ({ ...line }));
    const sourceLineByInvoiceIndex: Array<Record<string, unknown>> = [];
    const invoiceLines = deliveryLines.map((deliveryLine) => {
      const sourceLine = findSourceOrderLine(deliveryLine, availableOrderLines);
      if (!sourceLine) throw new Error("No se puede crear la factura sin líneas del pedido de origen.");
      sourceLineByInvoiceIndex.push(sourceLine);

      return {
        itemId: deliveryLine.itemId,
        description: String(deliveryLine.description ?? sourceLine.description ?? ""),
        quantity: Number(deliveryLine.quantity),
        unitPrice: Number(sourceLine.unitPrice),
        discountPct: Number(sourceLine.discountPct),
        taxRate: Number(sourceLine.taxRate),
        retentionRate: Number(sourceLine.retentionRate),
      };
    });
    const calculatedTotals = calculateInvoiceTotals(invoiceLines);
    const totals = deliveryCoversWholeOrder(deliveryLines, orderLines) ? pickStoredOrderTotals(order, calculatedTotals) : calculatedTotals;

    const issueDate = new Date();
    await assertFiscalPeriodOpen(input.companyId, issueDate, tx);

    const number = await reserveDocumentNumber(tx, input.companyId, input.fiscalYearId, "SALES_INVOICE", issueDate);
    const [created] = await tx
      .insert(invoice)
      .values({
        companyId: input.companyId,
        customerId: note.customerId,
        number,
        issueDate,
        dueDate: null,
        totalAmount: formatMoney(totals.totalAmount),
        status: "SENT",
      })
      .returning();

    if (invoiceLines.length > 0) {
      const lineValues = buildInvoiceLineInsertValues(created.id, invoiceLines).map((value, index) => {
        const sourceLine = sourceLineByInvoiceIndex[index];
        const storedLineTotal = sameQuantity(deliveryLines[index]?.quantity, sourceLine?.quantity)
          ? finiteMoney(sourceLine?.lineTotal)
          : null;
        return storedLineTotal === null ? value : { ...value, lineTotal: formatMoney(storedLineTotal) };
      });
      await tx.insert(invoiceLine).values(lineValues);
    }

    await postSalesInvoice({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      postedAt: issueDate,
      reference: `Factura ${created.number}`,
      invoiceId: created.id,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      retentionAmount: totals.retentionAmount,
      totalAmount: totals.totalAmount,
      dbClient: tx,
    });

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

    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "sales.delivery.invoice",
        entityName: "invoice",
        entityId: created.id,
        payload: {
          deliveryNoteId: note.id,
          salesOrderId: order.id,
          number: created.number,
          totalAmount: totals.totalAmount,
        },
      },
      tx,
    );

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
