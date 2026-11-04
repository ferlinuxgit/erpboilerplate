import { and, asc, count, eq, gte, inArray, lt, ne, not, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { bankAccount, bankTransaction, customer, expenseOcrJob, fiscalReport, invoice, partner, supplierInvoice } from "@/db/schema";
import { db } from "@/lib/db";
import { fiscalStatusLabels, getSpanishFiscalDueDate, getSpanishFiscalModel, isSpanishFiscalModelCode, parseSpanishFiscalPeriod } from "@/lib/fiscal-spain";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { resolveAdvisorPeriod, type AdvisorPeriod } from "@/server/advisor/period";
import type { SalesExportInvoice } from "@/server/advisor/export-model";
import { loadVatRegisters } from "@/server/fiscal/spain";
import { invoiceAmountsByIds } from "@/server/invoices/list";
import { creditedByInvoiceSubquery, invoiceIsDraftSql, invoiceLifecycleSql, netOutstandingSql, paidByInvoiceSubquery } from "@/server/invoices/sql";
import { listWhere } from "@/server/lists/paginate";
import { expenseExpressions, paidByInvoice } from "@/server/supplier-invoices/list";

/** Consultas del portal del asesor (solo lectura, siempre acotadas a la empresa del acceso). */

export const ADVISOR_PAGE_SIZE = 50;

export async function loadAdvisorPeriod(companyId: string, query: { year?: string | null; period?: string | null }) {
  const years = await listFiscalYears(companyId);
  return { years, period: resolveAdvisorPeriod(years, query) };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const sum = <T,>(rows: T[], pick: (row: T) => number | undefined) => round2(rows.reduce((total, row) => total + (pick(row) ?? 0), 0));

function rangeOf(period: AdvisorPeriod) {
  return { from: period.period.from, toExclusive: period.period.toExclusive };
}

/** Resumen del periodo: cifras de los libros registro de IVA (las del 303), pendientes y modelos. */
export async function getAdvisorSummary(companyId: string, period: AdvisorPeriod) {
  const { from, toExclusive } = rangeOf(period);
  const [vat, [drafts], [withoutDocument], [bankPending], reports] = await Promise.all([
    loadVatRegisters(companyId, from, toExclusive),
    db
      .select({ value: count() })
      .from(invoice)
      .where(and(eq(invoice.companyId, companyId), invoiceIsDraftSql, ne(invoice.status, "VOID"), gte(invoice.issueDate, from), lt(invoice.issueDate, toExclusive))),
    db
      .select({ value: count() })
      .from(supplierInvoice)
      .where(and(
        eq(supplierInvoice.companyId, companyId),
        ne(supplierInvoice.status, "VOID"),
        gte(supplierInvoice.issueDate, from),
        lt(supplierInvoice.issueDate, toExclusive),
        sql`not exists (select 1 from ${expenseOcrJob} where ${expenseOcrJob.supplierInvoiceId} = ${supplierInvoice.id})`,
      )),
    db
      .select({ value: count() })
      .from(bankTransaction)
      .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
      .where(and(eq(bankAccount.companyId, companyId), eq(bankTransaction.reconciliationStatus, "PENDING"), gte(bankTransaction.postedAt, from), lt(bankTransaction.postedAt, toExclusive))),
    listAdvisorFiscalReports(companyId, { from, toExclusive }),
  ]);
  return {
    sales: {
      count: vat.issued.length,
      base: sum(vat.issued, (row) => row.taxBase),
      tax: sum(vat.issued, (row) => row.taxAmount),
      withholding: sum(vat.issued, (row) => row.withholdingAmount),
      total: sum(vat.issued, (row) => row.totalAmount),
    },
    purchases: {
      count: vat.received.length,
      base: sum(vat.received, (row) => row.taxBase),
      deductibleTax: sum(vat.received, (row) => row.taxAmount),
      chargedTax: sum(vat.received, (row) => row.chargedTaxAmount ?? row.taxAmount),
      withholding: sum(vat.received, (row) => row.withholdingAmount),
      total: sum(vat.received, (row) => row.totalAmount),
    },
    pending: {
      draftInvoices: drafts?.value ?? 0,
      expensesWithoutDocument: withoutDocument?.value ?? 0,
      bankUnreconciled: bankPending?.value ?? 0,
    },
    reports,
  };
}

/** Modelos fiscales preparados cuyo periodo cae dentro del rango, con su estado de presentación. */
export async function listAdvisorFiscalReports(companyId: string, range: { from: Date; toExclusive: Date }) {
  const rows = await db.select().from(fiscalReport).where(eq(fiscalReport.companyId, companyId)).orderBy(asc(fiscalReport.period), asc(fiscalReport.code));
  return rows.flatMap((row) => {
    if (!isSpanishFiscalModelCode(row.code)) return [];
    const parsed = parseSpanishFiscalPeriod(row.period, row.code);
    if (!parsed || parsed.start < range.from || parsed.endExclusive > range.toExclusive) return [];
    return [{
      id: row.id,
      code: row.code,
      name: getSpanishFiscalModel(row.code)?.name ?? `Modelo ${row.code}`,
      period: row.period,
      periodLabel: parsed.label,
      status: row.status,
      statusLabel: fiscalStatusLabels[row.status],
      dueDate: getSpanishFiscalDueDate(row.period, row.code),
      filedAt: row.filedAt,
      filingReceiptNumber: row.filingReceiptNumber,
      paymentNrc: row.paymentNrc,
    }];
  });
}

export type AdvisorListQuery = { from: string; to: string; q: string; page: number; ids?: string[] };

/* ----------------------------------------------------------------------------------------------
 * Facturas emitidas
 * -------------------------------------------------------------------------------------------- */

function salesQueryParts(companyId: string, query: Omit<AdvisorListQuery, "page">) {
  const paid = paidByInvoiceSubquery(companyId);
  const credited = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paid, credited);
  const rectified = alias(invoice, "rectified_invoice");
  const where = listWhere({
    // Sin borradores: el asesor solo ve facturas con número definitivo (las anuladas, marcadas).
    base: [eq(invoice.companyId, companyId), not(invoiceIsDraftSql)],
    search: { q: query.q, columns: [invoice.number, customer.name, partner.taxId, sql`${invoice.totalAmount}::text`] },
    dateRange: { column: invoice.issueDate, from: query.from, to: query.to },
    filters: [query.ids ? inArray(invoice.id, query.ids.length > 0 ? query.ids : [""]) : undefined],
  });
  const columns = {
    id: invoice.id,
    number: invoice.number,
    invoiceType: invoice.invoiceType,
    rectifiedNumber: rectified.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    lifecycle: invoiceLifecycleSql,
    customerName: customer.name,
    customerSnapshot: invoice.customerSnapshot,
    partnerTaxId: partner.taxId,
    partnerCountryCode: partner.countryCode,
    vatTreatment: invoice.vatTreatment,
    totalAmount: invoice.totalAmount,
    paymentStatus: invoice.paymentStatus,
    paidAmount: sql<string>`coalesce(${paid.paidAmount}, 0)`.mapWith(Number),
    outstandingAmount: outstanding.mapWith(Number),
    // Totales de todo el filtro (para el pie del listado), repetidos en cada fila.
    total: sql<string>`count(*) over()`.mapWith(Number),
    sumTotal: sql<string>`sum(case when ${invoice.status} <> 'VOID' then ${invoice.totalAmount} else 0 end) over()`.mapWith(Number),
  };
  const select = () =>
    db
      .select(columns)
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .leftJoin(rectified, eq(rectified.id, invoice.rectifiedInvoiceId))
      .leftJoin(paid, eq(paid.invoiceId, invoice.id))
      .leftJoin(credited, eq(credited.invoiceId, invoice.id))
      .where(where)
      .orderBy(asc(invoice.issueDate), asc(invoice.number), asc(invoice.id));
  return { select };
}

type SalesRow = Awaited<ReturnType<ReturnType<typeof salesQueryParts>["select"]>>[number];

async function toSalesInvoices(rows: SalesRow[]): Promise<SalesExportInvoice[]> {
  const amounts = await invoiceAmountsByIds(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const totals = amounts.get(row.id);
    const total = Number(row.totalAmount);
    return {
      id: row.id,
      number: row.number,
      invoiceType: row.invoiceType === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE",
      rectifiedNumber: row.rectifiedNumber,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      lifecycle: row.lifecycle,
      customerName: row.customerSnapshot?.legalName || row.customerSnapshot?.name || row.customerName,
      customerTaxId: row.customerSnapshot?.taxId ?? row.partnerTaxId,
      customerCountryCode: row.customerSnapshot?.countryCode ?? row.partnerCountryCode,
      vatTreatment: row.vatTreatment,
      subtotal: totals?.subtotal ?? total,
      taxAmount: totals?.taxAmount ?? 0,
      retentionAmount: totals?.retentionAmount ?? 0,
      totalAmount: total,
      paidAmount: round2(row.paidAmount),
      outstandingAmount: round2(row.outstandingAmount),
      paymentStatus: row.lifecycle === "VOID" ? "VOID" : row.paymentStatus,
    };
  });
}

export async function listAdvisorSalesPage(companyId: string, query: AdvisorListQuery) {
  const parts = salesQueryParts(companyId, query);
  const rows = await parts
    .select()
    .limit(ADVISOR_PAGE_SIZE)
    .offset((query.page - 1) * ADVISOR_PAGE_SIZE);
  return { rows: await toSalesInvoices(rows), total: rows[0]?.total ?? 0, sumTotal: round2(rows[0]?.sumTotal ?? 0) };
}

/** Tope de facturas por descarga (los PDF se generan o leen uno a uno). */
export const ADVISOR_SALES_EXPORT_LIMIT = 2_000;
export const ADVISOR_SALES_PDF_LIMIT = 500;

export async function listAdvisorSalesForExport(companyId: string, query: Omit<AdvisorListQuery, "page">, limit = ADVISOR_SALES_EXPORT_LIMIT) {
  const rows = await salesQueryParts(companyId, query).select().limit(limit + 1);
  return { invoices: await toSalesInvoices(rows.slice(0, limit)), truncated: rows.length > limit };
}

/** Comprueba que la factura es de la empresa y no es un borrador (el asesor no ve borradores). */
export async function findAdvisorSalesInvoice(companyId: string, invoiceId: string) {
  const [row] = await db
    .select({ id: invoice.id, number: invoice.number })
    .from(invoice)
    .where(and(eq(invoice.companyId, companyId), eq(invoice.id, invoiceId), not(invoiceIsDraftSql)))
    .limit(1);
  return row ?? null;
}

/* ----------------------------------------------------------------------------------------------
 * Facturas recibidas (gastos)
 * -------------------------------------------------------------------------------------------- */

export async function listAdvisorExpensesPage(companyId: string, query: AdvisorListQuery) {
  const paid = paidByInvoice(companyId);
  const { paidAmount, paymentStatus } = expenseExpressions(paid, new Date());
  const documents = db
    .select({ supplierInvoiceId: expenseOcrJob.supplierInvoiceId, documentCount: sql<number>`count(*)::int`.as("documentCount") })
    .from(expenseOcrJob)
    .where(eq(expenseOcrJob.companyId, companyId))
    .groupBy(expenseOcrJob.supplierInvoiceId)
    .as("advisor_expense_documents");
  const where = listWhere({
    base: [eq(supplierInvoice.companyId, companyId), ne(supplierInvoice.status, "VOID")],
    search: { q: query.q, columns: [supplierInvoice.number, supplierInvoice.supplierDocumentNumber, partner.name, partner.taxId] },
    dateRange: { column: supplierInvoice.issueDate, from: query.from, to: query.to },
  });
  const rows = await db
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      issueDate: supplierInvoice.issueDate,
      accountingDate: supplierInvoice.accountingDate,
      supplierName: partner.name,
      supplierTaxId: partner.taxId,
      subtotalAmount: supplierInvoice.subtotalAmount,
      taxAmount: supplierInvoice.taxAmount,
      retentionAmount: supplierInvoice.retentionAmount,
      totalAmount: supplierInvoice.totalAmount,
      currencyCode: supplierInvoice.currencyCode,
      paidAmount: paidAmount.mapWith(Number),
      paymentStatus,
      documentCount: sql<number>`coalesce(${documents.documentCount}, 0)`.mapWith(Number),
      total: sql<string>`count(*) over()`.mapWith(Number),
      sumTotal: sql<string>`sum(${supplierInvoice.totalAmount}) over()`.mapWith(Number),
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(paid, eq(paid.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(documents, eq(documents.supplierInvoiceId, supplierInvoice.id))
    .where(where)
    .orderBy(asc(supplierInvoice.issueDate), asc(supplierInvoice.number), asc(supplierInvoice.id))
    .limit(ADVISOR_PAGE_SIZE)
    .offset((query.page - 1) * ADVISOR_PAGE_SIZE);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      number: row.number,
      supplierDocumentNumber: row.supplierDocumentNumber,
      issueDate: row.issueDate,
      accountingDate: row.accountingDate,
      supplierName: row.supplierName,
      supplierTaxId: row.supplierTaxId,
      currencyCode: row.currencyCode,
      paidAmount: row.paidAmount,
      paymentStatus: row.paymentStatus,
      documentCount: row.documentCount,
      subtotalAmount: Number(row.subtotalAmount),
      taxAmount: Number(row.taxAmount),
      retentionAmount: Number(row.retentionAmount),
      totalAmount: Number(row.totalAmount),
    })),
    total: rows[0]?.total ?? 0,
    sumTotal: round2(rows[0]?.sumTotal ?? 0),
  };
}

/** Documentos originales de una factura recibida (en orden de subida). */
export async function listAdvisorExpenseDocuments(companyId: string, supplierInvoiceId: string) {
  return db
    .select({ id: expenseOcrJob.id, fileName: expenseOcrJob.fileName, contentType: expenseOcrJob.contentType, filePath: expenseOcrJob.filePath, storageKey: expenseOcrJob.storageKey })
    .from(expenseOcrJob)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, expenseOcrJob.supplierInvoiceId))
    .where(and(eq(expenseOcrJob.companyId, companyId), eq(supplierInvoice.companyId, companyId), eq(expenseOcrJob.supplierInvoiceId, supplierInvoiceId)))
    .orderBy(asc(expenseOcrJob.createdAt));
}
