import { and, asc, count, eq, inArray, not, sql } from "drizzle-orm";

import { customer, invoice, invoiceLine, invoiceLineTax, paymentStatusEnum } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { calculateInvoiceTotals, type InvoiceCalculationTax } from "@/lib/invoice-totals";
import type { ListParams } from "@/lib/list-params";
import { todayDateInput } from "@/server/invoices/due-dates";
import {
  creditedByInvoiceSubquery,
  invoiceIsDraftSql,
  invoiceIsIssuedSql,
  invoiceLifecycleSql,
  netOutstandingSql,
  paidByInvoiceSubquery,
} from "@/server/invoices/sql";
import { countRows, listOrderBy, listWhere, paginate, unfilteredTotal, windowCount, windowTotals } from "@/server/lists/paginate";

/**
 * Listado de facturas (`/invoices`) en servidor: la página paginada y la exportación de todo lo
 * filtrado comparten búsqueda, filtros y orden.
 */

export const invoiceListConfig = {
  sortKeys: ["recent", "number", "customer", "issueDate", "dueDate", "total", "outstanding", "status"] as const,
  // Newest first: a just-created invoice is always on page 1.
  defaultSort: { key: "recent" as const, dir: "desc" as const },
  filters: { status: paymentStatusEnum.enumValues, due: ["overdue"], type: ["invoice", "credit_note", "draft"] },
};

export type InvoiceListSortKey = (typeof invoiceListConfig.sortKeys)[number];
export type InvoiceListParams = ListParams<InvoiceListSortKey, keyof typeof invoiceListConfig.filters>;

/** Tope de la exportación (se genera en el navegador). */
export const INVOICE_EXPORT_LIMIT = 10_000;

export type InvoiceAmounts = { subtotal: number; taxAmount: number; retentionAmount: number; totalAmount: number };

function listParts(companyId: string, params: InvoiceListParams, timezone: string | undefined) {
  // Payments and issued credit notes aggregated once per company (no per-invoice queries):
  // net outstanding = total + rectificativas − cobros, as in `getInvoiceBalance`.
  const paidByInvoice = paidByInvoiceSubquery(companyId);
  const creditedByInvoice = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paidByInvoice, creditedByInvoice);
  const isVoided = sql`(${invoice.paymentStatus} = 'VOID' or ${invoice.status} = 'VOID')`;
  // "Hoy" en la zona horaria de la empresa (España), no la del servidor.
  const startOfToday = new Date(`${todayDateInput(timezone || undefined)}T00:00:00.000Z`);
  const isOverdue = sql`(not ${isVoided} and ${outstanding} > 0 and ${invoice.dueDate} < ${startOfToday})`;

  const where = listWhere({
    base: [eq(invoice.companyId, companyId)],
    search: { q: params.q, columns: [invoice.number, customer.name, sql`${invoice.totalAmount}::text`] },
    dateRange: { column: invoice.issueDate, from: params.from, to: params.to },
    filters: [
      params.filters.status ? eq(invoice.paymentStatus, params.filters.status as (typeof paymentStatusEnum.enumValues)[number]) : undefined,
      params.filters.due === "overdue" ? isOverdue : undefined,
      params.filters.type === "draft" ? invoiceIsDraftSql : undefined,
      params.filters.type === "invoice" ? and(eq(invoice.invoiceType, "INVOICE"), not(invoiceIsDraftSql)) : undefined,
      params.filters.type === "credit_note" ? and(eq(invoice.invoiceType, "CREDIT_NOTE"), not(invoiceIsDraftSql)) : undefined,
    ],
  });
  const sortColumns = {
    recent: invoice.createdAt,
    number: invoice.number,
    customer: customer.name,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    total: invoice.totalAmount,
    outstanding,
    status: invoice.paymentStatus,
  };
  const columns = {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    paymentStatus: invoice.paymentStatus,
    invoiceType: invoice.invoiceType,
    lifecycle: invoiceLifecycleSql,
    totalAmount: invoice.totalAmount,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    outstandingAmount: outstanding.mapWith(Number),
    isOverdue: sql<boolean>`coalesce(${isOverdue}, false)`,
    customerName: customer.name,
  };
  const from = () => db
    .select(columns)
    .from(invoice)
    .innerJoin(customer, eq(invoice.customerId, customer.id))
    .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, invoice.id))
    .leftJoin(creditedByInvoice, eq(creditedByInvoice.invoiceId, invoice.id));
  return { where, sortColumns, columns, outstanding, paidByInvoice, creditedByInvoice, from };
}

/**
 * Base, IVA (impuestos que suman, incluido el recargo de equivalencia), IRPF (retenciones) y total
 * de cada factura, calculados desde sus líneas con el mismo motor que el PDF y la contabilidad.
 */
export async function invoiceAmountsByIds(client: DbClient, ids: string[]) {
  const amounts = new Map<string, InvoiceAmounts>();
  for (let start = 0; start < ids.length; start += 1_000) {
    const chunk = ids.slice(start, start + 1_000);
    const lines = await client
      .select({
        id: invoiceLine.id,
        invoiceId: invoiceLine.invoiceId,
        invoiceType: invoice.invoiceType,
        description: invoiceLine.description,
        quantity: invoiceLine.quantity,
        unitPrice: invoiceLine.unitPrice,
        discountPct: invoiceLine.discountPct,
        taxRate: invoiceLine.taxRate,
        retentionRate: invoiceLine.retentionRate,
      })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
      .where(inArray(invoiceLine.invoiceId, chunk))
      // Orden de alta de las líneas (como loadStoredLines); con el JOIN hay que calificar ctid.
      .orderBy(asc(invoiceLine.invoiceId), asc(sql`"invoice_line"."ctid"`));
    const taxes = new Map<string, InvoiceCalculationTax[]>();
    for (let taxStart = 0; taxStart < lines.length; taxStart += 5_000) {
      const lineIds = lines.slice(taxStart, taxStart + 5_000).map((line) => line.id);
      if (lineIds.length === 0) continue;
      const rows = await client
        .select({ invoiceLineId: invoiceLineTax.invoiceLineId, taxId: invoiceLineTax.taxId, name: invoiceLineTax.name, rate: invoiceLineTax.rate, kind: invoiceLineTax.kind, operation: invoiceLineTax.operation })
        .from(invoiceLineTax)
        .where(inArray(invoiceLineTax.invoiceLineId, lineIds));
      for (const row of rows) {
        taxes.set(row.invoiceLineId, [
          ...(taxes.get(row.invoiceLineId) ?? []),
          { id: row.taxId, name: row.name, rate: Number(row.rate), kind: row.kind, operation: row.operation === "SUBTRACT" ? "SUBTRACT" : "ADD" },
        ]);
      }
    }
    const linesByInvoice = new Map<string, typeof lines>();
    for (const line of lines) linesByInvoice.set(line.invoiceId, [...(linesByInvoice.get(line.invoiceId) ?? []), line]);
    for (const [invoiceId, invoiceLines] of linesByInvoice) {
      const totals = calculateInvoiceTotals(
        invoiceLines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountPct: Number(line.discountPct),
          taxRate: Number(line.taxRate),
          retentionRate: Number(line.retentionRate),
          // Facturas antiguas sin impuestos detallados: se usan taxRate/retentionRate de la línea.
          ...(taxes.has(line.id) ? { taxes: taxes.get(line.id)! } : {}),
        })),
        // Las rectificativas llevan importes negativos (igual que en la ficha de la factura).
        { allowNegative: invoiceLines[0]?.invoiceType === "CREDIT_NOTE" },
      );
      amounts.set(invoiceId, { subtotal: totals.subtotal, taxAmount: totals.taxAmount, retentionAmount: totals.retentionAmount, totalAmount: totals.totalAmount });
    }
  }
  return amounts;
}

type InvoiceListDbRow = Awaited<ReturnType<ReturnType<typeof listParts>["from"]>>[number];

/** Fila tal como la usa el listado (cliente), con los importes para la exportación. */
function toListRow(row: InvoiceListDbRow, currencyCode: string, amounts: InvoiceAmounts | undefined) {
  const outstandingAmount = Math.round(row.outstandingAmount * 100) / 100;
  return {
    id: row.id,
    number: row.number,
    status: row.paymentStatus,
    lifecycle: row.lifecycle,
    invoiceType: row.invoiceType === "CREDIT_NOTE" ? "CREDIT_NOTE" as const : "INVOICE" as const,
    totalAmount: row.totalAmount,
    totalAmountLabel: formatMoney(row.totalAmount.toString(), currencyCode),
    outstandingAmount,
    outstandingAmountLabel: formatMoney(outstandingAmount, currencyCode),
    issueDate: row.issueDate,
    issueDateLabel: formatDate(row.issueDate),
    dueDate: row.dueDate,
    dueDateLabel: row.dueDate ? formatDate(row.dueDate) : null,
    isOverdue: Boolean(row.isOverdue),
    customerName: row.customerName,
    subtotalAmount: amounts?.subtotal ?? null,
    taxAmount: amounts?.taxAmount ?? null,
    retentionAmount: amounts?.retentionAmount ?? null,
  };
}

export type InvoiceListRow = ReturnType<typeof toListRow>;

export async function listInvoicesPage(companyId: string, params: InvoiceListParams, options: { timezone?: string; currencyCode: string }) {
  const parts = listParts(companyId, params, options.timezone);
  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          ...parts.columns,
          total: windowCount(),
          // Totales del pie: solo facturas con validez fiscal (sin borradores ni anuladas); los borradores aparte.
          ...windowTotals({
            sumTotal: sql`case when ${invoiceIsIssuedSql} then ${invoice.totalAmount} else 0 end`,
            sumOutstanding: parts.outstanding,
            sumDrafts: sql`case when ${invoiceIsDraftSql} and ${invoice.status} <> 'VOID' then ${invoice.totalAmount} else 0 end`,
            draftCount: sql`case when ${invoiceIsDraftSql} and ${invoice.status} <> 'VOID' then 1 else 0 end`,
          }),
        })
        .from(invoice)
        .innerJoin(customer, eq(invoice.customerId, customer.id))
        .leftJoin(parts.paidByInvoice, eq(parts.paidByInvoice.invoiceId, invoice.id))
        .leftJoin(parts.creditedByInvoice, eq(parts.creditedByInvoice.invoiceId, invoice.id))
        .where(parts.where)
        .orderBy(...listOrderBy(parts.sortColumns, params, invoice.id))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(
        db
          .select({ value: count() })
          .from(invoice)
          .innerJoin(customer, eq(invoice.customerId, customer.id))
          .leftJoin(parts.paidByInvoice, eq(parts.paidByInvoice.invoiceId, invoice.id))
          .leftJoin(parts.creditedByInvoice, eq(parts.creditedByInvoice.invoiceId, invoice.id))
          .where(parts.where),
      ),
  });
  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(db.select({ value: count() }).from(invoice).where(eq(invoice.companyId, companyId))),
  );
  // Importes de la página (para exportar filas seleccionadas sin otra consulta).
  const amounts = await invoiceAmountsByIds(db, result.rows.map((row) => row.id));
  const firstRow = result.rows[0];
  return {
    result,
    recordCount,
    totals: { totalAmount: firstRow?.sumTotal ?? 0, outstandingAmount: firstRow?.sumOutstanding ?? 0, draftAmount: firstRow?.sumDrafts ?? 0, draftCount: firstRow?.draftCount ?? 0 },
    rows: result.rows.map((row) => toListRow(row, options.currencyCode, amounts.get(row.id))),
  };
}

/** Todas las facturas del filtro (sin paginar), con sus importes, para exportarlas. */
export async function listInvoicesForExport(companyId: string, params: InvoiceListParams, options: { timezone?: string; currencyCode: string }) {
  const parts = listParts(companyId, params, options.timezone);
  const rows = await parts
    .from()
    .where(parts.where)
    .orderBy(...listOrderBy(parts.sortColumns, params, invoice.id))
    .limit(INVOICE_EXPORT_LIMIT + 1);
  if (rows.length > INVOICE_EXPORT_LIMIT) {
    throw new Error(`Hay más de ${INVOICE_EXPORT_LIMIT} facturas en el filtro. Acota las fechas o la búsqueda para exportar.`);
  }
  const amounts = await invoiceAmountsByIds(db, rows.map((row) => row.id));
  return rows.map((row) => toListRow(row, options.currencyCode, amounts.get(row.id)));
}
