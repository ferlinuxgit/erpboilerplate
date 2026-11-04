import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";

import { bankAccount, bankTransaction, customer, invoice, partner, payment, paymentMethod, posRegister, posSession, supplierInvoice, supplierPayment } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  buildGestorPackageZip,
  buildJournalWorkbook,
  buildLedgerWorkbook,
  buildTrialBalanceWorkbook,
  buildVatRegisterWorkbook,
} from "@/server/accounting/gestor-package-model";
import { loadGestorPackageData } from "@/server/accounting/gestor-package";
import type { AdvisorContext } from "@/server/advisor/auth";
import { ADVISOR_SALES_PDF_LIMIT, listAdvisorSalesForExport } from "@/server/advisor/data";
import { advisorFileBaseName, buildAdvisorWorkbook, buildSalesZip, salesColumns, type SheetSpec, type WorkbookMeta } from "@/server/advisor/export-model";
import type { AdvisorPeriod } from "@/server/advisor/period";
import { invoiceIsIssuedSql } from "@/server/invoices/sql";
import { getInvoicePdf } from "@/server/invoices/stored-pdf";
import type { SessionSummary } from "@/server/pos/service";
import { generateExpenseExport } from "@/server/supplier-invoices/export";

/**
 * Ficheros que descarga el asesor. Todos se generan en el momento con los datos actuales y
 * acotados a la empresa del acceso; quien llama audita la descarga.
 */

export type AdvisorFile = { bytes: Uint8Array; fileName: string; contentType: string; count?: number; missing?: number };

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP = "application/zip";

function meta(context: AdvisorContext, period: AdvisorPeriod, title: string): WorkbookMeta {
  return { title, companyName: context.company.name, companyTaxId: context.company.vatNumber, periodLabel: period.period.label, generatedAt: new Date() };
}

/* ------------------------------------------------------------------ Ventas */

export async function exportAdvisorSales(context: AdvisorContext, period: AdvisorPeriod, options: { q: string; ids?: string[]; withPdfs: boolean }): Promise<AdvisorFile> {
  const limit = options.withPdfs ? ADVISOR_SALES_PDF_LIMIT : undefined;
  const { invoices, truncated } = await listAdvisorSalesForExport(context.company.id, { from: period.from, to: period.to, q: options.q, ids: options.ids }, limit);
  if (truncated) {
    throw new HttpError(422, options.withPdfs
      ? `Hay más de ${ADVISOR_SALES_PDF_LIMIT} facturas con PDF en esta selección. Descarga un periodo más corto (un mes o un trimestre) o solo el listado en Excel.`
      : "Hay demasiadas facturas en esta selección. Descarga un periodo más corto.");
  }
  const workbookMeta = meta(context, period, "Facturas emitidas");
  const baseName = advisorFileBaseName("facturas-emitidas", context.company.name, period.period.label);
  if (!options.withPdfs) {
    const bytes = await buildAdvisorWorkbook(workbookMeta, [{ name: "Facturas emitidas", columns: salesColumns(), rows: invoices }]);
    return { bytes, fileName: `${baseName}.xlsx`, contentType: XLSX, count: invoices.length };
  }
  const zip = await buildSalesZip({
    meta: workbookMeta,
    baseName,
    invoices,
    loadPdf: async (row) => {
      const pdf = await getInvoicePdf(context.company.id, row.id);
      return pdf ? new Uint8Array(pdf.bytes) : null;
    },
  });
  return { bytes: zip.bytes, fileName: `${baseName}.zip`, contentType: ZIP, count: invoices.length, missing: zip.missing.length };
}

/* ------------------------------------------------------------------ Gastos */

export async function exportAdvisorExpenses(context: AdvisorContext, period: AdvisorPeriod, options: { q: string; ids?: string[]; withDocuments: boolean }): Promise<AdvisorFile> {
  const result = await generateExpenseExport({
    companyId: context.company.id,
    tenantId: context.tenantId,
    actorUserId: null,
    filters: { from: period.from, to: period.to, q: options.q, status: null, ids: options.ids },
    includeDocuments: options.withDocuments,
  });
  return { bytes: result.bytes, fileName: result.fileName, contentType: result.contentType, missing: result.missing.length };
}

/* ------------------------------------------------------------------ Libros contables y de IVA */

export const ADVISOR_BOOKS = {
  diario: { label: "Libro diario", scope: "accounting" },
  mayor: { label: "Libro mayor", scope: "accounting" },
  "sumas-y-saldos": { label: "Sumas y saldos", scope: "accounting" },
  "iva-expedidas": { label: "Libro registro de IVA · facturas expedidas", scope: "taxes" },
  "iva-recibidas": { label: "Libro registro de IVA · facturas recibidas", scope: "taxes" },
  paquete: { label: "Paquete contable y fiscal (ZIP)", scope: "accounting" },
} as const;

export type AdvisorBookKey = keyof typeof ADVISOR_BOOKS;

export function isAdvisorBookKey(value: string): value is AdvisorBookKey {
  return Object.hasOwn(ADVISOR_BOOKS, value);
}

export async function exportAdvisorBook(context: AdvisorContext, period: AdvisorPeriod, book: AdvisorBookKey): Promise<AdvisorFile> {
  const { data } = await loadGestorPackageData({
    companyId: context.company.id,
    countryCode: context.company.countryCode,
    fiscalYearId: period.year.id,
    periodKey: period.period.key,
    includeModelPdfs: book === "paquete",
  });
  const name = (kind: string, extension: string) => `${advisorFileBaseName(kind, context.company.name, period.period.label)}.${extension}`;
  switch (book) {
    case "diario":
      return { bytes: await buildJournalWorkbook(data), fileName: name("libro-diario", "xlsx"), contentType: XLSX };
    case "mayor":
      return { bytes: await buildLedgerWorkbook(data), fileName: name("libro-mayor", "xlsx"), contentType: XLSX };
    case "sumas-y-saldos":
      return { bytes: await buildTrialBalanceWorkbook(data), fileName: name("sumas-y-saldos", "xlsx"), contentType: XLSX };
    case "iva-expedidas":
      return { bytes: await buildVatRegisterWorkbook(data, "issued"), fileName: name("libro-iva-expedidas", "xlsx"), contentType: XLSX, count: data.vatIssued.length };
    case "iva-recibidas":
      return { bytes: await buildVatRegisterWorkbook(data, "received"), fileName: name("libro-iva-recibidas", "xlsx"), contentType: XLSX, count: data.vatReceived.length };
    case "paquete": {
      const zip = await buildGestorPackageZip(data);
      return { bytes: zip.bytes, fileName: name("paquete-contable", "zip"), contentType: ZIP };
    }
  }
}

/* ------------------------------------------------------------------ Otros datos */

export const ADVISOR_DATASETS = {
  clientes: { label: "Clientes", description: "Ficha fiscal de cada cliente y lo facturado en el periodo (base para el 347).", scope: "sales" },
  cobros: { label: "Cobros de clientes", description: "Cobros registrados en el periodo, con factura y medio de pago.", scope: "sales" },
  proveedores: { label: "Proveedores", description: "Ficha fiscal de cada proveedor y lo facturado en el periodo.", scope: "expenses" },
  pagos: { label: "Pagos a proveedores", description: "Pagos registrados en el periodo, con factura, cuenta y referencia.", scope: "expenses" },
  bancos: { label: "Movimientos bancarios", description: "Extracto de todas las cuentas en el periodo, con su estado de conciliación.", scope: "banking" },
  tpv: { label: "Cierres de caja (TPV)", description: "Informes Z cerrados en el periodo: ventas, efectivo, tarjeta, devoluciones, descuadres e IVA.", scope: "pos" },
} as const;

export type AdvisorDatasetKey = keyof typeof ADVISOR_DATASETS;

export function isAdvisorDatasetKey(value: string): value is AdvisorDatasetKey {
  return Object.hasOwn(ADVISOR_DATASETS, value);
}

async function partnerSheet(context: AdvisorContext, period: AdvisorPeriod, kind: "customers" | "suppliers"): Promise<SheetSpec<Record<string, unknown>>> {
  const { from, toExclusive } = period.period;
  const types = kind === "customers" ? (["CUSTOMER", "BOTH"] as const) : (["SUPPLIER", "BOTH"] as const);
  const totals = kind === "customers"
    ? db
      .select({ partnerId: sql<string>`${customer.partnerId}`.as("partnerId"), invoiced: sql<string>`sum(${invoice.totalAmount})`.as("invoiced"), invoices: sql<number>`count(*)::int`.as("invoices") })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .where(and(eq(invoice.companyId, context.company.id), invoiceIsIssuedSql, gte(invoice.issueDate, from), lt(invoice.issueDate, toExclusive)))
      .groupBy(customer.partnerId)
      .as("advisor_partner_totals")
    : db
      .select({ partnerId: sql<string>`${supplierInvoice.supplierPartnerId}`.as("partnerId"), invoiced: sql<string>`sum(${supplierInvoice.totalAmount})`.as("invoiced"), invoices: sql<number>`count(*)::int`.as("invoices") })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.companyId, context.company.id), sql`${supplierInvoice.status} <> 'VOID'`, gte(supplierInvoice.issueDate, from), lt(supplierInvoice.issueDate, toExclusive)))
      .groupBy(supplierInvoice.supplierPartnerId)
      .as("advisor_partner_totals");
  const rows = await db
    .select({
      number: partner.number,
      name: partner.name,
      taxId: partner.taxId,
      address: partner.address,
      postalCode: partner.postalCode,
      city: partner.city,
      province: partner.province,
      countryCode: partner.countryCode,
      email: partner.email,
      phone: partner.phone,
      invoices: sql<number>`coalesce(${totals.invoices}, 0)`.mapWith(Number),
      invoiced: sql<string>`coalesce(${totals.invoiced}, 0)`.mapWith(Number),
    })
    .from(partner)
    .leftJoin(totals, eq(totals.partnerId, partner.id))
    .where(and(eq(partner.companyId, context.company.id), inArray(partner.type, [...types])))
    .orderBy(asc(partner.name));
  return {
    name: kind === "customers" ? "Clientes" : "Proveedores",
    rows,
    columns: [
      { header: "Código", width: 10, value: (row) => row.number as string },
      { header: "Nombre / razón social", width: 36, value: (row) => row.name as string },
      { header: "NIF", width: 16, value: (row) => (row.taxId as string | null) ?? "" },
      { header: "Dirección", width: 34, value: (row) => (row.address as string | null) ?? "" },
      { header: "CP", width: 8, value: (row) => (row.postalCode as string | null) ?? "" },
      { header: "Población", width: 18, value: (row) => (row.city as string | null) ?? "" },
      { header: "Provincia", width: 16, value: (row) => (row.province as string | null) ?? "" },
      { header: "País", width: 6, value: (row) => row.countryCode as string },
      { header: "Email", width: 26, value: (row) => (row.email as string | null) ?? "" },
      { header: "Teléfono", width: 14, value: (row) => (row.phone as string | null) ?? "" },
      { header: "Facturas en el periodo", width: 12, type: "number", total: true, value: (row) => row.invoices as number },
      { header: "Total facturado (IVA incl.)", width: 16, type: "money", total: true, value: (row) => row.invoiced as number },
    ],
  };
}

async function receiptsSheet(context: AdvisorContext, period: AdvisorPeriod): Promise<SheetSpec<Record<string, unknown>>> {
  const rows = await db
    .select({ number: payment.number, postedAt: payment.postedAt, invoiceNumber: invoice.number, customerName: customer.name, method: paymentMethod.name, amount: payment.amount })
    .from(payment)
    .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(paymentMethod, eq(paymentMethod.id, payment.paymentMethodId))
    .where(and(eq(payment.companyId, context.company.id), gte(payment.postedAt, period.period.from), lt(payment.postedAt, period.period.toExclusive)))
    .orderBy(asc(payment.postedAt), asc(payment.number));
  return {
    name: "Cobros",
    rows,
    columns: [
      { header: "Cobro", width: 14, value: (row) => row.number as string },
      { header: "Fecha", width: 12, type: "date", value: (row) => row.postedAt as Date },
      { header: "Factura", width: 16, value: (row) => row.invoiceNumber as string },
      { header: "Cliente", width: 34, value: (row) => row.customerName as string },
      { header: "Medio de pago", width: 20, value: (row) => (row.method as string | null) ?? "" },
      { header: "Importe", width: 14, type: "money", total: true, value: (row) => Number(row.amount) },
    ],
  };
}

async function supplierPaymentsSheet(context: AdvisorContext, period: AdvisorPeriod): Promise<SheetSpec<Record<string, unknown>>> {
  const rows = await db
    .select({
      number: supplierPayment.number,
      postedAt: supplierPayment.postedAt,
      supplierName: partner.name,
      supplierTaxId: partner.taxId,
      invoiceNumber: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      bankName: bankAccount.bankName,
      reference: supplierPayment.reference,
      amount: supplierPayment.amount,
    })
    .from(supplierPayment)
    .innerJoin(partner, eq(partner.id, supplierPayment.supplierPartnerId))
    .leftJoin(supplierInvoice, eq(supplierInvoice.id, supplierPayment.supplierInvoiceId))
    .leftJoin(bankAccount, eq(bankAccount.id, supplierPayment.bankAccountId))
    .where(and(eq(supplierPayment.companyId, context.company.id), gte(supplierPayment.postedAt, period.period.from), lt(supplierPayment.postedAt, period.period.toExclusive)))
    .orderBy(asc(supplierPayment.postedAt), asc(supplierPayment.number));
  return {
    name: "Pagos",
    rows,
    columns: [
      { header: "Pago", width: 14, value: (row) => row.number as string },
      { header: "Fecha", width: 12, type: "date", value: (row) => row.postedAt as Date },
      { header: "Proveedor", width: 34, value: (row) => row.supplierName as string },
      { header: "NIF", width: 16, value: (row) => (row.supplierTaxId as string | null) ?? "" },
      { header: "Registro", width: 14, value: (row) => (row.invoiceNumber as string | null) ?? "" },
      { header: "Factura proveedor", width: 18, value: (row) => (row.supplierDocumentNumber as string | null) ?? "" },
      { header: "Cuenta", width: 20, value: (row) => (row.bankName as string | null) ?? "" },
      { header: "Referencia", width: 20, value: (row) => (row.reference as string | null) ?? "" },
      { header: "Importe", width: 14, type: "money", total: true, value: (row) => Number(row.amount) },
    ],
  };
}

async function bankSheet(context: AdvisorContext, period: AdvisorPeriod): Promise<SheetSpec<Record<string, unknown>>> {
  const rows = await db
    .select({
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
      postedAt: bankTransaction.postedAt,
      valueDate: bankTransaction.valueDate,
      description: bankTransaction.description,
      reference: bankTransaction.reference,
      amount: bankTransaction.amount,
      balanceAfter: bankTransaction.balanceAfter,
      status: bankTransaction.reconciliationStatus,
    })
    .from(bankTransaction)
    .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankAccount.companyId, context.company.id), gte(bankTransaction.postedAt, period.period.from), lt(bankTransaction.postedAt, period.period.toExclusive)))
    .orderBy(asc(bankAccount.bankName), asc(bankTransaction.postedAt), asc(bankTransaction.id));
  return {
    name: "Movimientos",
    rows,
    columns: [
      { header: "Cuenta", width: 20, value: (row) => row.bankName as string },
      { header: "IBAN", width: 28, value: (row) => (row.iban as string | null) ?? "" },
      { header: "Fecha", width: 12, type: "date", value: (row) => row.postedAt as Date },
      { header: "Fecha valor", width: 12, type: "date", value: (row) => row.valueDate as Date | null },
      { header: "Concepto", width: 44, value: (row) => row.description as string },
      { header: "Referencia", width: 18, value: (row) => (row.reference as string | null) ?? "" },
      { header: "Importe", width: 14, type: "money", value: (row) => Number(row.amount) },
      { header: "Saldo", width: 14, type: "money", value: (row) => (row.balanceAfter === null ? null : Number(row.balanceAfter)) },
      { header: "Conciliado", width: 11, value: (row) => (row.status === "RECONCILED" ? "Sí" : "No") },
    ],
  };
}

async function posSheets(context: AdvisorContext, period: AdvisorPeriod): Promise<Array<SheetSpec<Record<string, unknown>>>> {
  const sessions = await db
    .select({ id: posSession.id, register: posRegister.name, openedAt: posSession.openedAt, closedAt: posSession.closedAt, openingCash: posSession.openingCash, expectedCash: posSession.expectedCash, countedCash: posSession.countedCash, difference: posSession.difference, notes: posSession.closingNotes, report: posSession.closingReport })
    .from(posSession)
    .innerJoin(posRegister, eq(posRegister.id, posSession.registerId))
    .where(and(eq(posSession.companyId, context.company.id), eq(posSession.status, "CLOSED"), gte(posSession.closedAt, period.period.from), lt(posSession.closedAt, period.period.toExclusive)))
    .orderBy(asc(posSession.closedAt));
  const rows = sessions.map((session) => {
    const report = (session.report ?? null) as Partial<SessionSummary> | null;
    return { ...session, report };
  });
  const taxRows = new Map<number, { rate: number; base: number; tax: number }>();
  for (const row of rows) {
    for (const line of row.report?.taxBreakdown ?? []) {
      const current = taxRows.get(line.rate) ?? { rate: line.rate, base: 0, tax: 0 };
      current.base += line.base;
      current.tax += line.tax;
      taxRows.set(line.rate, current);
    }
  }
  return [
    {
      name: "Cierres de caja",
      rows,
      columns: [
        { header: "Caja", width: 18, value: (row) => row.register as string },
        { header: "Apertura", width: 18, value: (row) => (row.openedAt as Date).toISOString().replace("T", " ").slice(0, 16) },
        { header: "Cierre", width: 12, type: "date", value: (row) => row.closedAt as Date },
        { header: "Tickets", width: 9, type: "number", total: true, value: (row) => (row.report as Partial<SessionSummary> | null)?.sales?.count ?? 0 },
        { header: "Ventas", width: 13, type: "money", total: true, value: (row) => (row.report as Partial<SessionSummary> | null)?.sales?.total ?? 0 },
        { header: "Efectivo", width: 13, type: "money", total: true, value: (row) => (row.report as Partial<SessionSummary> | null)?.sales?.cash ?? 0 },
        { header: "Tarjeta", width: 13, type: "money", total: true, value: (row) => (row.report as Partial<SessionSummary> | null)?.sales?.card ?? 0 },
        { header: "Devoluciones", width: 13, type: "money", total: true, value: (row) => (row.report as Partial<SessionSummary> | null)?.refunds?.total ?? 0 },
        { header: "Venta neta", width: 13, type: "money", total: true, value: (row) => (row.report as Partial<SessionSummary> | null)?.netTotal ?? 0 },
        { header: "Propinas", width: 11, type: "money", total: true, value: (row) => (row.report as Partial<SessionSummary> | null)?.tips ?? 0 },
        { header: "Fondo inicial", width: 12, type: "money", value: (row) => Number(row.openingCash) },
        { header: "Efectivo esperado", width: 13, type: "money", value: (row) => (row.expectedCash === null ? null : Number(row.expectedCash)) },
        { header: "Efectivo contado", width: 13, type: "money", value: (row) => (row.countedCash === null ? null : Number(row.countedCash)) },
        { header: "Descuadre", width: 12, type: "money", total: true, value: (row) => (row.difference === null ? 0 : Number(row.difference)) },
        { header: "Notas", width: 30, value: (row) => (row.notes as string | null) ?? "" },
      ],
    },
    {
      name: "IVA por tipo",
      rows: [...taxRows.values()].sort((a, b) => a.rate - b.rate).map((row) => ({ ...row, base: Math.round(row.base * 100) / 100, tax: Math.round(row.tax * 100) / 100 })),
      columns: [
        { header: "Tipo IVA %", width: 10, type: "percent", value: (row) => row.rate as number },
        { header: "Base", width: 14, type: "money", total: true, value: (row) => row.base as number },
        { header: "Cuota", width: 14, type: "money", total: true, value: (row) => row.tax as number },
      ],
    },
  ];
}

export async function exportAdvisorDataset(context: AdvisorContext, period: AdvisorPeriod, dataset: AdvisorDatasetKey): Promise<AdvisorFile> {
  const sheets = await (async () => {
    switch (dataset) {
      case "clientes":
        return [await partnerSheet(context, period, "customers")];
      case "proveedores":
        return [await partnerSheet(context, period, "suppliers")];
      case "cobros":
        return [await receiptsSheet(context, period)];
      case "pagos":
        return [await supplierPaymentsSheet(context, period)];
      case "bancos":
        return [await bankSheet(context, period)];
      case "tpv":
        return posSheets(context, period);
    }
  })();
  const label = ADVISOR_DATASETS[dataset].label;
  const bytes = await buildAdvisorWorkbook(meta(context, period, label), sheets);
  return { bytes, fileName: `${advisorFileBaseName(dataset, context.company.name, period.period.label)}.xlsx`, contentType: XLSX, count: sheets[0]?.rows.length ?? 0 };
}

/* ------------------------------------------------------------------ Paquete completo del periodo */

/**
 * Todo el periodo en un ZIP, según las secciones del acceso: ventas (PDF + listado), gastos
 * (documentos + listado), libros contables y de IVA, modelos y el resto de listados.
 */
export async function exportAdvisorFullPackage(context: AdvisorContext, period: AdvisorPeriod): Promise<AdvisorFile> {
  const scopes = new Set(context.access.scopes);
  const files: Record<string, Uint8Array> = {};
  const notes: string[] = [];
  const unzipInto = async (folder: string, zipBytes: Uint8Array) => {
    const { unzipSync } = await import("fflate");
    for (const [path, bytes] of Object.entries(unzipSync(zipBytes))) files[`${folder}/${path}`] = bytes;
  };
  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      notes.push(`${label}: ${error instanceof HttpError ? error.message : "no se pudo generar; descárgalo por separado desde su sección."}`);
    }
  };

  if (scopes.has("sales")) {
    await attempt("Ventas", async () => {
      const sales = await exportAdvisorSales(context, period, { q: "", withPdfs: true });
      await unzipInto("01-ventas", sales.bytes);
    });
  }
  if (scopes.has("expenses")) {
    await attempt("Gastos", async () => {
      const expenses = await exportAdvisorExpenses(context, period, { q: "", withDocuments: true });
      await unzipInto("02-gastos", expenses.bytes);
    });
  }
  if (scopes.has("accounting") || scopes.has("taxes")) {
    await attempt("Contabilidad e impuestos", async () => {
      const { data } = await loadGestorPackageData({ companyId: context.company.id, countryCode: context.company.countryCode, fiscalYearId: period.year.id, periodKey: period.period.key, includeModelPdfs: scopes.has("taxes") });
      if (!scopes.has("accounting")) {
        files["03-contabilidad-e-impuestos/libro-registro-iva-expedidas.xlsx"] = await buildVatRegisterWorkbook(data, "issued");
        files["03-contabilidad-e-impuestos/libro-registro-iva-recibidas.xlsx"] = await buildVatRegisterWorkbook(data, "received");
        for (const pdf of data.modelPdfs) files[`03-contabilidad-e-impuestos/modelos/${pdf.fileName}`] = pdf.bytes;
        return;
      }
      await unzipInto("03-contabilidad-e-impuestos", (await buildGestorPackageZip(data)).bytes);
    });
  }
  for (const [key, dataset] of Object.entries(ADVISOR_DATASETS) as Array<[AdvisorDatasetKey, (typeof ADVISOR_DATASETS)[AdvisorDatasetKey]]>) {
    if (!scopes.has(dataset.scope)) continue;
    await attempt(dataset.label, async () => {
      const file = await exportAdvisorDataset(context, period, key);
      files[`04-otros/${file.fileName}`] = file.bytes;
    });
  }

  const generatedAt = new Date();
  const readme = [
    `Documentación del periodo · ${context.company.name}${context.company.vatNumber ? ` (${context.company.vatNumber})` : ""}`,
    `Periodo: ${period.period.label} (del ${period.from} al ${period.to})`,
    `Generado: ${generatedAt.toISOString()} por ${context.access.name} (${context.email})`,
    "",
    "Carpetas:",
    scopes.has("sales") ? "- 01-ventas: facturas emitidas en PDF y su listado en Excel." : null,
    scopes.has("expenses") ? "- 02-gastos: facturas recibidas (documento original) y su listado en Excel con el desglose de IVA." : null,
    scopes.has("accounting") || scopes.has("taxes") ? "- 03-contabilidad-e-impuestos: libros contables y registros de IVA, y los PDF de los modelos preparados." : null,
    "- 04-otros: clientes, proveedores, cobros, pagos, bancos y cierres de caja (según tu acceso).",
    ...(notes.length > 0 ? ["", "Avisos:", ...notes.map((note) => `- ${note}`)] : []),
  ].filter((line): line is string => line !== null).join("\r\n");
  files["LEEME.txt"] = strToU8(readme);
  return {
    bytes: zipSync(files, { level: 1, mtime: generatedAt }),
    fileName: `${advisorFileBaseName("documentacion", context.company.name, period.period.label)}.zip`,
    contentType: ZIP,
    missing: notes.length,
  };
}

