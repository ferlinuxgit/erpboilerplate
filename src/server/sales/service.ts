import { and, count, eq, ne } from "drizzle-orm";

import {
  auditLog,
  customer,
  deliveryNote,
  deliveryNoteLine,
  invoice,
  salesOrder,
  salesOrderLine,
  salesQuote,
  salesQuoteLine,
  stockMovement,
  stockLocation,
  tax,
  warehouse,
} from "@/db/schema";
import { db, type AppDbTransaction, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { InvoiceCalculationTax } from "@/lib/invoice-totals";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";
import { refreshStockLocation } from "@/server/inventory/stock-location";
import { findRetentionTaxByRate, findVatTaxByRate } from "@/server/invoices/default-taxes";
import { computeDueDate } from "@/server/invoices/due-dates";
import { resolveInvoicePaymentMethods } from "@/server/invoices/payment-methods";
import {
  createDraftInvoiceInTransaction,
  ensureCompanyDefaults,
  issueInvoiceInTransaction,
  resolveCustomerBillingDefaults,
  type InvoiceActor,
} from "@/server/invoices/service";
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

/** Igual que `assertSalesTransitionAllowed`, pero con un error HTTP seguro para el cliente (400). */
function assertTransitionOrHttpError(result: ReturnType<typeof getSalesOrderTransition>) {
  try {
    assertSalesTransitionAllowed(result);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Transición de documento no permitida.", { cause: error });
  }
}

async function reserveDocumentNumber(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], companyId: string, fiscalYearId: string, type: SeriesType, referenceDate?: Date | string | null) {
  return reserveSeriesNumber(tx, { companyId, fiscalYearId, type, referenceDate });
}

function findSourceOrderLine(
  deliveryLine: Record<string, unknown>,
  availableOrderLines: Array<Record<string, unknown> & { __matched?: boolean }>,
) {
  const unmatchedLines = availableOrderLines.filter((line) => !line.__matched);
  const salesOrderLineId = deliveryLine.salesOrderLineId;
  if (salesOrderLineId) {
    const direct = unmatchedLines.find((line) => line.id === salesOrderLineId);
    if (!direct) return null;
    direct.__matched = true;
    return direct;
  }
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
  tenantId: string;
  companyId: string;
  actorUserId: string;
  fiscalYearId: string;
  quoteId: string;
}) {
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(salesQuote)
      .where(and(eq(salesQuote.id, input.quoteId), eq(salesQuote.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!quote) throw new HttpError(404, "Presupuesto no encontrado.");
    if (quote.status === "CONFIRMED" || quote.status === "REJECTED") {
      // Aceptado a mano: se puede convertir si aún no tiene pedido ni factura.
      const blocker = quoteConversionBlocker(quote.status, await quoteLinks(tx, input.companyId, quote.id));
      if (blocker) throw new HttpError(409, blocker);
    } else {
      assertTransitionOrHttpError(getSalesQuoteTransition(quote.status as SalesDocumentStatus));
    }

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
      .where(and(eq(salesQuote.id, quote.id), eq(salesQuote.companyId, input.companyId)));

    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "salesQuote.convert",
        entityName: "salesQuote",
        entityId: quote.id,
        payload: {
          quoteNumber: quote.number,
          salesOrderId: created.id,
          salesOrderNumber: created.number,
          totalAmount: created.totalAmount,
        },
      },
      tx,
    );

    return created;
  });
}

export async function convertOrderToDelivery(input: {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  fiscalYearId: string;
  salesOrderId: string;
  warehouseId?: string | null;
  lines?: Array<{ salesOrderLineId: string; quantity: number }>;
}) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(salesOrder)
      .where(and(eq(salesOrder.id, input.salesOrderId), eq(salesOrder.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!order) throw new HttpError(404, "Pedido no encontrado.");
    assertTransitionOrHttpError(getSalesOrderTransition(order.status as SalesDocumentStatus));

    const [ownedWarehouse] = input.warehouseId
      ? await tx
          .select({ id: warehouse.id })
          .from(warehouse)
          .where(and(eq(warehouse.id, input.warehouseId), eq(warehouse.companyId, input.companyId)))
          .limit(1)
      : await tx.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.companyId, input.companyId)).limit(1);
    if (!ownedWarehouse) throw new HttpError(404, "Almacén no encontrado.");

    const issuedAt = new Date();
    const number = await reserveDocumentNumber(tx, input.companyId, input.fiscalYearId, "DELIVERY_NOTE", issuedAt);
    const orderLines = await tx.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, order.id));
    if (orderLines.length === 0) throw new HttpError(400, "No se puede crear el albarán sin líneas del pedido de origen.");

    const previousDeliveryLines = await tx
      .select({ salesOrderLineId: deliveryNoteLine.salesOrderLineId, quantity: deliveryNoteLine.quantity })
      .from(deliveryNoteLine)
      .innerJoin(deliveryNote, eq(deliveryNote.id, deliveryNoteLine.deliveryNoteId))
      .where(eq(deliveryNote.salesOrderId, order.id));
    const deliveredByLine = new Map<string, number>();
    for (const line of previousDeliveryLines) if (line.salesOrderLineId) deliveredByLine.set(line.salesOrderLineId, (deliveredByLine.get(line.salesOrderLineId) ?? 0) + Number(line.quantity));
    const orderLineById = new Map(orderLines.map((line) => [line.id, line]));
    const requested = input.lines?.length ? input.lines : orderLines.flatMap((line) => {
      const remaining = Number(line.quantity) - (deliveredByLine.get(line.id) ?? 0);
      return remaining > 0.0005 ? [{ salesOrderLineId: line.id, quantity: remaining }] : [];
    });
    if (requested.length === 0) throw new HttpError(400, "El pedido ya está entregado por completo.");
    const quantitiesByLine = new Map<string, number>();
    for (const requestLine of requested) {
      const source = orderLineById.get(requestLine.salesOrderLineId);
      if (!source || !Number.isFinite(requestLine.quantity) || requestLine.quantity <= 0) throw new HttpError(400, "Las líneas del albarán no pertenecen al pedido o tienen una cantidad inválida.");
      const accumulated = (quantitiesByLine.get(source.id) ?? 0) + requestLine.quantity;
      const remaining = Number(source.quantity) - (deliveredByLine.get(source.id) ?? 0);
      if (accumulated > remaining + 0.0005) throw new HttpError(400, `La cantidad de ${source.description} supera la pendiente de entrega.`);
      quantitiesByLine.set(source.id, accumulated);
    }

    const [created] = await tx
      .insert(deliveryNote)
      .values({
        companyId: input.companyId,
        customerId: order.customerId,
        salesOrderId: order.id,
        warehouseId: ownedWarehouse.id,
        number,
        issuedAt,
        status: "DELIVERED",
      })
      .returning();

    const insertedLines = await tx
      .insert(deliveryNoteLine)
      .values(
        [...quantitiesByLine.entries()].map(([salesOrderLineId, quantity]) => {
          const line = orderLineById.get(salesOrderLineId)!;
          return {
          deliveryNoteId: created.id,
          salesOrderLineId,
          itemId: line.itemId,
          description: line.description,
          quantity: quantity.toFixed(3),
        }}),
      )
      .returning();

    for (const line of insertedLines) {
      if (!line.itemId) continue;
      const [location] = await tx
        .select({ currentQuantity: stockLocation.currentQuantity })
        .from(stockLocation)
        .where(and(eq(stockLocation.companyId, input.companyId), eq(stockLocation.itemId, line.itemId), eq(stockLocation.warehouseId, ownedWarehouse.id)))
        .for("update")
        .limit(1);
      if (Number(location?.currentQuantity ?? 0) + 0.0005 < Number(line.quantity)) {
        throw new HttpError(400, `Stock insuficiente para entregar ${line.description}.`);
      }
      await tx.insert(stockMovement).values({
        companyId: input.companyId,
        itemId: line.itemId,
        warehouseId: ownedWarehouse.id,
        movementType: "OUT",
        quantity: line.quantity,
        movedAt: new Date(),
        reason: "Entrega de pedido de venta",
        reference: `delivery-note:${created.id}`,
      });
      await refreshStockLocation({ companyId: input.companyId, itemId: line.itemId, warehouseId: ownedWarehouse.id }, tx);
    }

    const fullyDelivered = orderLines.every((line) => (deliveredByLine.get(line.id) ?? 0) + (quantitiesByLine.get(line.id) ?? 0) >= Number(line.quantity) - 0.0005);
    await tx
      .update(salesOrder)
      .set({ status: fullyDelivered ? "DELIVERED" : "CONFIRMED", updatedAt: new Date() })
      .where(eq(salesOrder.id, order.id));

    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "deliveryNote.create",
        entityName: "deliveryNote",
        entityId: created.id,
        payload: {
          salesOrderId: order.id,
          salesOrderNumber: order.number,
          warehouseId: ownedWarehouse.id,
          number: created.number,
          lines: [...quantitiesByLine.entries()].map(([salesOrderLineId, quantity]) => ({ salesOrderLineId, quantity })),
          salesOrderStatus: fullyDelivered ? "DELIVERED" : "CONFIRMED",
        },
      },
      tx,
    );

    return created;
  });
}

type InvoiceSourceLine = {
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  retentionRate: number;
};

type CompanyTaxRow = { id: string; name: string; rate: string | number; kind: string; operation: string; isDefault: boolean; isActive: boolean };

/**
 * Presupuestos, pedidos y albaranes guardan el tipo de IVA y el % de retención; la factura guarda
 * impuestos configurados. Se busca el impuesto de la empresa con ese tipo (para que el desglose,
 * los modelos y VERI*FACTU sean idénticos a una factura hecha a mano) y, si no existe, se congela
 * un impuesto equivalente con el mismo tipo.
 */
export function mapSalesLineTaxes(line: Pick<InvoiceSourceLine, "taxRate" | "retentionRate">, taxes: CompanyTaxRow[]): InvoiceCalculationTax[] {
  const result: InvoiceCalculationTax[] = [];
  if (line.taxRate > 0) {
    const vat = findVatTaxByRate(taxes, line.taxRate);
    result.push(vat
      ? { id: vat.id, name: vat.name, rate: Number(vat.rate), kind: "VAT", operation: "ADD" }
      : { id: null, name: `IVA ${line.taxRate.toLocaleString("es-ES")} %`, rate: line.taxRate, kind: "VAT", operation: "ADD" });
  }
  if (line.retentionRate > 0) {
    const retention = findRetentionTaxByRate(taxes, line.retentionRate);
    result.push(retention
      ? { id: retention.id, name: retention.name, rate: Number(retention.rate), kind: "WITHHOLDING", operation: "SUBTRACT" }
      : { id: null, name: `Retención IRPF ${line.retentionRate.toLocaleString("es-ES")} %`, rate: line.retentionRate, kind: "WITHHOLDING", operation: "SUBTRACT" });
  }
  return result;
}

async function toInvoiceLines(tx: DbClient, companyId: string, lines: InvoiceSourceLine[]) {
  const taxes = await tx
    .select({ id: tax.id, name: tax.name, rate: tax.rate, kind: tax.kind, operation: tax.operation, isDefault: tax.isDefault, isActive: tax.isActive })
    .from(tax)
    .where(eq(tax.companyId, companyId));
  return lines.map((line) => ({
    itemId: line.itemId,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPct: line.discountPct,
    taxRate: line.taxRate,
    retentionRate: line.retentionRate,
    taxes: mapSalesLineTaxes(line, taxes),
  }));
}

function storedLine(line: { itemId: string | null; description: string; quantity: string; unitPrice: string; discountPct: string; taxRate: string; retentionRate: string }): InvoiceSourceLine {
  return {
    itemId: line.itemId,
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    discountPct: Number(line.discountPct ?? 0),
    taxRate: Number(line.taxRate ?? 0),
    retentionRate: Number(line.retentionRate ?? 0),
  };
}

/** Borrador de factura con las condiciones del cliente (vencimiento, formas de pago). */
async function createInvoiceDraftFromSales(
  tx: AppDbTransaction,
  actor: SalesInvoiceActor,
  input: { customerId: string; lines: InvoiceSourceLine[]; notes: string; source: { salesQuoteId?: string | null; salesOrderId?: string | null; deliveryNoteId?: string | null }; auditPayload: Record<string, unknown> },
) {
  const billing = await resolveCustomerBillingDefaults(tx, actor.companyId, input.customerId);
  const issueDate = new Date();
  const paymentMethods = (await resolveInvoicePaymentMethods(actor.companyId, billing.paymentMethodIds)) ?? [];
  const lines = await toInvoiceLines(tx, actor.companyId, input.lines);
  return createDraftInvoiceInTransaction(tx, actor, {
    customerId: input.customerId,
    issueDate,
    dueDate: computeDueDate(issueDate, billing.termsDays),
    paymentMethods,
    lines,
    // null = automático: al emitir se aplica el tratamiento habitual del cliente o el de su país.
    vatTreatment: null,
    notes: input.notes,
    source: input.source,
    auditPayload: input.auditPayload,
  });
}

export type SalesInvoiceActor = InvoiceActor;

async function findExistingDeliveryInvoice(tx: DbClient, input: { tenantId: string; companyId: string }, deliveryNoteId: string) {
  const [linked] = await tx
    .select({ id: invoice.id, number: invoice.number, totalAmount: invoice.totalAmount })
    .from(invoice)
    .where(and(eq(invoice.companyId, input.companyId), eq(invoice.deliveryNoteId, deliveryNoteId)))
    .limit(1);
  if (linked) return linked;
  // Albaranes facturados antes de existir `invoice.deliveryNoteId`: se busca en la auditoría.
  const invoiceAuditRows = await tx
    .select({ entityId: auditLog.entityId, payload: auditLog.payload })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, input.tenantId), eq(auditLog.companyId, input.companyId), eq(auditLog.action, "sales.delivery.invoice"), eq(auditLog.entityName, "invoice")));
  const linkedAudit = invoiceAuditRows.find((row) => {
    if (!row.payload) return false;
    try {
      return (JSON.parse(row.payload) as { deliveryNoteId?: unknown }).deliveryNoteId === deliveryNoteId;
    } catch {
      return false;
    }
  });
  if (!linkedAudit) return null;
  const [existingInvoice] = await tx
    .select({ id: invoice.id, number: invoice.number, totalAmount: invoice.totalAmount })
    .from(invoice)
    .where(and(eq(invoice.id, linkedAudit.entityId), eq(invoice.companyId, input.companyId)))
    .limit(1);
  return existingInvoice ?? null;
}

/**
 * Albarán → factura EMITIDA por el flujo único de emisión (`issueInvoiceInTransaction`): valida el
 * tratamiento de IVA, congela los datos fiscales, numera por la serie de la fecha, contabiliza,
 * registra en VERI*FACTU, aplica vencimiento y formas de pago del cliente. Todo en una transacción.
 */
export async function convertDeliveryToInvoice(input: SalesInvoiceActor & { deliveryNoteId: string }) {
  await ensureCompanyDefaults(input);
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select()
      .from(deliveryNote)
      .where(and(eq(deliveryNote.id, input.deliveryNoteId), eq(deliveryNote.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!note) throw new HttpError(404, "Albarán no encontrado.");
    const deliveryTransition = getDeliveryNoteTransition(note.status as SalesDocumentStatus);
    if (deliveryTransition.allowed === false) {
      if (note.status === "INVOICED" || note.status === "PAID") {
        const existing = await findExistingDeliveryInvoice(tx, input, note.id);
        if (existing) return { ...existing, status: "SENT", alreadyInvoiced: true };
      }
      throw new HttpError(409, deliveryTransition.reason);
    }

    const [order] = note.salesOrderId
      ? await tx
          .select()
          .from(salesOrder)
          .where(and(eq(salesOrder.id, note.salesOrderId), eq(salesOrder.companyId, input.companyId)))
          .limit(1)
      : [null];
    if (!order) throw new HttpError(409, "No se puede facturar un albarán sin pedido de origen.");

    const deliveryLines = await tx.select().from(deliveryNoteLine).where(eq(deliveryNoteLine.deliveryNoteId, note.id));
    if (deliveryLines.length === 0) throw new HttpError(409, "No se puede crear la factura sin líneas del albarán de origen.");
    const orderLines = await tx.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, order.id));
    if (orderLines.length === 0) throw new HttpError(409, "No se puede crear la factura sin líneas del pedido de origen.");

    const availableOrderLines = orderLines.map((line) => ({ ...line }));
    const sourceLines: InvoiceSourceLine[] = deliveryLines.map((deliveryLine) => {
      const sourceLine = findSourceOrderLine(deliveryLine, availableOrderLines);
      if (!sourceLine) throw new HttpError(409, "No se puede crear la factura sin líneas del pedido de origen.");
      return {
        itemId: deliveryLine.itemId,
        description: String(deliveryLine.description ?? sourceLine.description ?? ""),
        quantity: Number(deliveryLine.quantity),
        unitPrice: Number(sourceLine.unitPrice),
        discountPct: Number(sourceLine.discountPct ?? 0),
        taxRate: Number(sourceLine.taxRate ?? 0),
        retentionRate: Number(sourceLine.retentionRate ?? 0),
      };
    });

    const draft = await createInvoiceDraftFromSales(tx, input, {
      customerId: note.customerId,
      lines: sourceLines,
      notes: `Albarán ${note.number}${order.number ? ` · Pedido ${order.number}` : ""}`,
      source: { deliveryNoteId: note.id, salesOrderId: order.id, salesQuoteId: order.salesQuoteId ?? null },
      auditPayload: { origin: "deliveryNote", deliveryNoteId: note.id },
    });
    const issued = await issueInvoiceInTransaction(tx, input, draft.id);

    await tx
      .update(deliveryNote)
      .set({ status: "INVOICED", updatedAt: new Date() })
      .where(eq(deliveryNote.id, note.id));

    const siblingDeliveries = await tx.select({ id: deliveryNote.id, status: deliveryNote.status }).from(deliveryNote).where(eq(deliveryNote.salesOrderId, order.id));
    const allDeliveriesInvoiced = siblingDeliveries.every((delivery) => delivery.id === note.id || delivery.status === "INVOICED" || delivery.status === "PAID");
    await tx
      .update(salesOrder)
      .set({ status: allDeliveriesInvoiced ? "INVOICED" : "DELIVERED", updatedAt: new Date() })
      .where(eq(salesOrder.id, order.id));

    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "sales.delivery.invoice",
        entityName: "invoice",
        entityId: issued.id,
        payload: { deliveryNoteId: note.id, salesOrderId: order.id, number: issued.number, totalAmount: Number(issued.totalAmount) },
      },
      tx,
    );

    return { id: issued.id, number: issued.number, status: issued.status, totalAmount: issued.totalAmount, alreadyInvoiced: false };
  });
}

/** Presupuesto: estados a los que se puede pasar a mano (Enviado / Aceptado / Rechazado / Anulado). */
export const QUOTE_STATUS_ACTIONS = {
  SENT: { from: ["DRAFT"], label: "Marcar como enviado", done: "Presupuesto marcado como enviado." },
  CONFIRMED: { from: ["DRAFT", "SENT"], label: "Marcar como aceptado", done: "Presupuesto aceptado. Ya puedes convertirlo en pedido o factura." },
  REJECTED: { from: ["DRAFT", "SENT", "CONFIRMED"], label: "Marcar como rechazado", done: "Presupuesto marcado como rechazado." },
  VOID: { from: ["DRAFT", "SENT", "CONFIRMED", "REJECTED"], label: "Anular", done: "Presupuesto anulado." },
} as const;

export type QuoteStatusTarget = keyof typeof QUOTE_STATUS_ACTIONS;

/** Motivo por el que un presupuesto no puede convertirse (en pedido o factura), o null. */
export function quoteConversionBlocker(status: string, linked: { orders: number; invoices: number }) {
  if (status === "VOID") return "El presupuesto está anulado.";
  if (status === "REJECTED") return "El cliente rechazó el presupuesto. Márcalo como aceptado si ha cambiado de opinión.";
  if (linked.orders > 0 || linked.invoices > 0 || status === "INVOICED" || status === "DELIVERED" || status === "PAID") {
    return "Este presupuesto ya se convirtió en pedido o factura.";
  }
  if (!["DRAFT", "SENT", "CONFIRMED"].includes(status)) return "Este presupuesto no se puede convertir.";
  return null;
}

export function assertQuoteStatusChange(current: string, target: QuoteStatusTarget, linked: { orders: number; invoices: number }) {
  const action = QUOTE_STATUS_ACTIONS[target];
  if (!(action.from as readonly string[]).includes(current)) {
    throw new HttpError(409, current === target ? "El presupuesto ya está en ese estado." : "Ese cambio de estado no está permitido para este presupuesto.");
  }
  if (target !== "VOID" && (linked.orders > 0 || linked.invoices > 0)) {
    throw new HttpError(409, "Este presupuesto ya se convirtió en pedido o factura: su estado se actualiza solo.");
  }
}

async function quoteLinks(tx: DbClient, companyId: string, quoteId: string) {
  const [[orders], [invoices]] = await Promise.all([
    tx.select({ value: count() }).from(salesOrder).where(and(eq(salesOrder.companyId, companyId), eq(salesOrder.salesQuoteId, quoteId))),
    tx.select({ value: count() }).from(invoice).where(and(eq(invoice.companyId, companyId), eq(invoice.salesQuoteId, quoteId), ne(invoice.status, "VOID"))),
  ]);
  return { orders: Number(orders?.value ?? 0), invoices: Number(invoices?.value ?? 0) };
}

export async function setQuoteStatus(input: { tenantId: string; companyId: string; actorUserId: string; quoteId: string; status: QuoteStatusTarget }) {
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select({ id: salesQuote.id, number: salesQuote.number, status: salesQuote.status })
      .from(salesQuote)
      .where(and(eq(salesQuote.id, input.quoteId), eq(salesQuote.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!quote) throw new HttpError(404, "Presupuesto no encontrado.");
    assertQuoteStatusChange(quote.status, input.status, await quoteLinks(tx, input.companyId, quote.id));
    await tx
      .update(salesQuote)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(salesQuote.id, quote.id), eq(salesQuote.companyId, input.companyId)));
    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "salesQuote.status",
        entityName: "salesQuote",
        entityId: quote.id,
        payload: { number: quote.number, from: quote.status, to: input.status },
      },
      tx,
    );
    return { id: quote.id, number: quote.number, status: input.status, message: QUOTE_STATUS_ACTIONS[input.status].done };
  });
}

/** Presupuesto → factura BORRADOR con las mismas líneas (empresas de servicios, sin pedido ni albarán). */
export async function convertQuoteToInvoice(input: SalesInvoiceActor & { quoteId: string }) {
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(salesQuote)
      .where(and(eq(salesQuote.id, input.quoteId), eq(salesQuote.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!quote) throw new HttpError(404, "Presupuesto no encontrado.");
    const blocker = quoteConversionBlocker(quote.status, await quoteLinks(tx, input.companyId, quote.id));
    if (blocker) throw new HttpError(409, blocker);
    const lines = await tx.select().from(salesQuoteLine).where(eq(salesQuoteLine.salesQuoteId, quote.id));
    if (lines.length === 0) throw new HttpError(409, "El presupuesto no tiene líneas que facturar.");

    const draft = await createInvoiceDraftFromSales(tx, input, {
      customerId: quote.customerId,
      lines: lines.map(storedLine),
      notes: `Presupuesto ${quote.number}`,
      source: { salesQuoteId: quote.id },
      auditPayload: { origin: "salesQuote", salesQuoteId: quote.id },
    });
    await tx
      .update(salesQuote)
      .set({ status: "INVOICED", updatedAt: new Date() })
      .where(and(eq(salesQuote.id, quote.id), eq(salesQuote.companyId, input.companyId)));
    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "salesQuote.invoice",
        entityName: "salesQuote",
        entityId: quote.id,
        payload: { quoteNumber: quote.number, invoiceId: draft.id },
      },
      tx,
    );
    return { id: draft.id, number: draft.number, status: draft.status };
  });
}

/** Pedido sin entregas → factura BORRADOR con sus líneas (servicios o venta sin albarán). */
export async function convertOrderToInvoice(input: SalesInvoiceActor & { salesOrderId: string }) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(salesOrder)
      .where(and(eq(salesOrder.id, input.salesOrderId), eq(salesOrder.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!order) throw new HttpError(404, "Pedido no encontrado.");
    const blocker = await orderChangeBlocker(tx, input.companyId, order, "invoice");
    if (blocker) throw new HttpError(409, blocker);
    const lines = await tx.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, order.id));
    if (lines.length === 0) throw new HttpError(409, "El pedido no tiene líneas que facturar.");

    const draft = await createInvoiceDraftFromSales(tx, input, {
      customerId: order.customerId,
      lines: lines.map(storedLine),
      notes: `Pedido ${order.number}`,
      source: { salesOrderId: order.id, salesQuoteId: order.salesQuoteId ?? null },
      auditPayload: { origin: "salesOrder", salesOrderId: order.id },
    });
    await tx
      .update(salesOrder)
      .set({ status: "INVOICED", updatedAt: new Date() })
      .where(and(eq(salesOrder.id, order.id), eq(salesOrder.companyId, input.companyId)));
    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "salesOrder.invoice",
        entityName: "salesOrder",
        entityId: order.id,
        payload: { orderNumber: order.number, invoiceId: draft.id },
      },
      tx,
    );
    return { id: draft.id, number: draft.number, status: draft.status };
  });
}

/**
 * Por qué un pedido no se puede editar, anular o facturar directamente (o null).
 * Con albaranes, el pedido sigue su curso por los albaranes.
 */
export async function orderChangeBlocker(tx: DbClient, companyId: string, order: { id: string; status: string }, action: "edit" | "cancel" | "invoice") {
  if (order.status === "VOID") return "El pedido está anulado.";
  if (order.status === "INVOICED" || order.status === "PAID") return "El pedido ya está facturado.";
  const [[deliveries], [invoices]] = await Promise.all([
    tx.select({ value: count() }).from(deliveryNote).where(and(eq(deliveryNote.companyId, companyId), eq(deliveryNote.salesOrderId, order.id))),
    tx.select({ value: count() }).from(invoice).where(and(eq(invoice.companyId, companyId), eq(invoice.salesOrderId, order.id), ne(invoice.status, "VOID"))),
  ]);
  if (Number(invoices?.value ?? 0) > 0) return "El pedido ya tiene una factura.";
  if (Number(deliveries?.value ?? 0) > 0) {
    return action === "invoice"
      ? "El pedido ya tiene albaranes: factura desde cada albarán."
      : "El pedido ya tiene albaranes y no se puede modificar.";
  }
  return null;
}

export async function cancelSalesOrder(input: { tenantId: string; companyId: string; actorUserId: string; salesOrderId: string }) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status })
      .from(salesOrder)
      .where(and(eq(salesOrder.id, input.salesOrderId), eq(salesOrder.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!order) throw new HttpError(404, "Pedido no encontrado.");
    const blocker = await orderChangeBlocker(tx, input.companyId, order, "cancel");
    if (blocker) throw new HttpError(409, blocker);
    await tx.update(salesOrder).set({ status: "VOID", updatedAt: new Date() }).where(and(eq(salesOrder.id, order.id), eq(salesOrder.companyId, input.companyId)));
    await recordAudit(
      { tenantId: input.tenantId, companyId: input.companyId, actorUserId: input.actorUserId, action: "salesOrder.cancel", entityName: "salesOrder", entityId: order.id, payload: { number: order.number, from: order.status } },
      tx,
    );
    return { id: order.id, number: order.number, status: "VOID" };
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
