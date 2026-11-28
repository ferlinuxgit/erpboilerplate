import { and, asc, eq, gte, isNotNull, lt, ne, or } from "drizzle-orm";

import { accountChart, company, journalEntry, journalLine, partner, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { standardVatRate } from "@/lib/country-packs/vat-rates";
import { db } from "@/lib/db";
import { isSpanishFiscalModelCode, parseSpanishFiscalPeriod, resolveSupplierVatTreatment } from "@/lib/fiscal-spain";
import { journalEntryOriginLabel } from "@/lib/status-labels";
import { AccountingRuleError } from "@/server/accounting/errors";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { buildGestorPackageZip, buildReceivedRegisterRows, gestorPackageFileName, type GestorJournalLine, type GestorPackageData, type ReceivedRegisterLine } from "@/server/accounting/gestor-package-model";
import { toCents } from "@/server/accounting/money";
import { loadStatementAccountRows } from "@/server/accounting/statements";
import { buildFinancialStatements, resolveStatementPeriod } from "@/server/accounting/statements-model";
import { recordAudit } from "@/server/audit";
import { getCompanyFiscalContext } from "@/server/company/fiscal-context";
import { listFiscalReports, resolveFiscalReportSummary } from "@/server/fiscal/service";
import { loadVatRegisters } from "@/server/fiscal/spain";
import { renderFiscalReportPdf } from "@/server/pdf/render";

async function loadJournalLines(companyId: string, from: Date, toExclusive: Date): Promise<GestorJournalLine[]> {
  const rows = await db
    .select({
      entryId: journalEntry.id,
      number: journalEntry.number,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
      concept: journalLine.concept,
      isAutomatic: journalEntry.isAutomatic,
      sourceType: journalEntry.sourceType,
      reversesEntryId: journalEntry.reversesEntryId,
      accountCode: accountChart.code,
      accountName: accountChart.name,
      debit: journalLine.debit,
      credit: journalLine.credit,
      lineId: journalLine.id,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(eq(journalEntry.companyId, companyId), gte(journalEntry.postedAt, from), lt(journalEntry.postedAt, toExclusive)))
    .orderBy(asc(journalEntry.postedAt), asc(journalEntry.number), asc(journalLine.lineNumber), asc(journalLine.id));
  // Dentro de cada asiento, primero las líneas al debe (presentación habitual del libro diario).
  return rows.map((row) => ({
    entryId: row.entryId,
    number: row.number,
    postedAt: row.postedAt,
    // Concepto del apunte (tercero y documento); los asientos antiguos sin él usan la referencia.
    reference: row.concept ?? row.reference,
    origin: journalEntryOriginLabel(row),
    accountCode: row.accountCode,
    accountName: row.accountName,
    debit: toCents(row.debit) / 100,
    credit: toCents(row.credit) / 100,
  })).sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.number.localeCompare(b.number) || b.debit - a.debit);
}

/**
 * Líneas de las facturas recibidas del periodo para el libro registro, con el mismo criterio que el
 * modelo 303 (`fetchSupplierLines` en fiscal/spain.ts): cada factura computa en su fecha de registro
 * y una anulada con fecha de anulación resta (fila de signo −1) en el periodo de la anulación.
 */
async function loadReceivedRegisterRows(companyId: string, from: Date, toExclusive: Date) {
  const { homeCountry } = await getCompanyFiscalContext(companyId);
  const columns = {
    invoiceId: supplierInvoice.id,
    number: supplierInvoice.number,
    supplierNumber: supplierInvoice.supplierDocumentNumber,
    supplierName: partner.name,
    supplierTaxId: partner.taxId,
    countryCode: partner.countryCode,
    issueDate: supplierInvoice.issueDate,
    accountingDate: supplierInvoice.accountingDate,
    voidedAt: supplierInvoice.voidedAt,
    operationDate: supplierInvoice.operationDate,
    documentKind: supplierInvoice.documentKind,
    rectifiedDocumentNumber: supplierInvoice.rectifiedDocumentNumber,
    rectifiedIssueDate: supplierInvoice.rectifiedIssueDate,
    vatTreatment: supplierInvoice.vatTreatment,
    isSimplified: supplierInvoice.isSimplified,
    importDuaNumber: supplierInvoice.importDuaNumber,
    importDuaDate: supplierInvoice.importDuaDate,
    totalAmount: supplierInvoice.totalAmount,
    prorrataPct: supplierInvoice.prorrataPct,
    base: supplierInvoiceLine.subtotalAmount,
    taxRate: supplierInvoiceLine.taxRate,
    taxAmount: supplierInvoiceLine.taxAmount,
    taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
    surchargeRate: supplierInvoiceLine.surchargeRate,
    surchargeAmount: supplierInvoiceLine.surchargeAmount,
    retentionAmount: supplierInvoiceLine.retentionAmount,
    isInvestmentGood: supplierInvoiceLine.isInvestmentGood,
  };
  const query = () => db
    .select(columns)
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId));
  const [registered, voided] = await Promise.all([
    query().where(and(
      eq(supplierInvoice.companyId, companyId),
      ne(supplierInvoice.status, "DRAFT"),
      or(ne(supplierInvoice.status, "VOID"), isNotNull(supplierInvoice.voidedAt)),
      gte(supplierInvoice.accountingDate, from),
      lt(supplierInvoice.accountingDate, toExclusive),
    )),
    query().where(and(
      eq(supplierInvoice.companyId, companyId),
      eq(supplierInvoice.status, "VOID"),
      gte(supplierInvoice.voidedAt, from),
      lt(supplierInvoice.voidedAt, toExclusive),
    )),
  ]);
  const toLine = (row: (typeof registered)[number], sign: 1 | -1): ReceivedRegisterLine => ({
    ...row,
    sign,
    registrationDate: sign === 1 ? row.accountingDate : row.voidedAt ?? row.accountingDate,
    vatTreatment: resolveSupplierVatTreatment(row.vatTreatment, row.countryCode, null, homeCountry),
  });
  return buildReceivedRegisterRows(
    [...registered.map((row) => toLine(row, 1)), ...voided.map((row) => toLine(row, -1))],
    { selfAssessmentRate: standardVatRate(homeCountry) },
  );
}

/**
 * Datos del paquete para el gestor (libros, IVA y PDF de los modelos) del periodo pedido
 * (ejercicio + periodo). Lo usan el ZIP del paquete y las descargas sueltas del portal del asesor.
 */
export async function loadGestorPackageData(input: { companyId: string; countryCode: string; fiscalYearId: string; periodKey: string | null; includeModelPdfs?: boolean }) {
  const years = await listFiscalYears(input.companyId);
  const year = years.find((candidate) => candidate.id === input.fiscalYearId);
  if (!year) throw new AccountingRuleError(404, "FISCAL_YEAR_NOT_FOUND", "Ejercicio no encontrado.");
  const period = resolveStatementPeriod(year, input.periodKey);
  const to = new Date(period.toExclusive.getTime() - 86_400_000);

  const [[companyRow], journal, statementRows, vat, vatReceivedDetail, reports] = await Promise.all([
    db.select({ name: company.name, vatNumber: company.vatNumber }).from(company).where(eq(company.id, input.companyId)).limit(1),
    loadJournalLines(input.companyId, period.from, period.toExclusive),
    loadStatementAccountRows(input.companyId, { yearStart: year.startsAt, from: period.from, toExclusive: period.toExclusive }),
    loadVatRegisters(input.companyId, period.from, period.toExclusive),
    loadReceivedRegisterRows(input.companyId, period.from, period.toExclusive),
    input.includeModelPdfs === false ? Promise.resolve([]) : listFiscalReports(input.companyId),
  ]);
  const statements = buildFinancialStatements(statementRows, input.countryCode);
  const companyName = companyRow?.name ?? "Empresa";

  const reportsInPeriod = reports.filter((report) => {
    if (!isSpanishFiscalModelCode(report.code)) return false;
    const range = parseSpanishFiscalPeriod(report.period, report.code);
    return Boolean(range && range.start >= period.from && range.endExclusive <= period.toExclusive);
  });
  const modelPdfs: Array<{ fileName: string; bytes: Uint8Array }> = [];
  // En serie: cada PDF carga el cálculo completo del modelo; evita picos de conexiones a la base de datos.
  for (const report of reportsInPeriod) {
    if (!isSpanishFiscalModelCode(report.code)) continue;
    // Un modelo presentado va tal como se presentó (foto guardada), no recalculado con los datos de hoy.
    const resolved = await resolveFiscalReportSummary(input.companyId, report);
    if (!resolved) continue;
    const pdf = await renderFiscalReportPdf({ companyName, summary: resolved.summary });
    modelPdfs.push({ fileName: `modelo-${report.code}-${report.period}.pdf`, bytes: new Uint8Array(pdf) });
  }

  const data: GestorPackageData = {
    companyName,
    companyTaxId: companyRow?.vatNumber ?? null,
    periodLabel: period.label,
    from: period.from,
    to,
    journal,
    openingBalances: new Map(statementRows.map((row) => [row.code, row.priorCents / 100])),
    trialBalance: statements.trialBalance,
    vatIssued: vat.issued,
    vatReceived: vat.received,
    vatReceivedDetail,
    modelPdfs,
    generatedAt: new Date(),
  };
  return { data, year, period };
}

/**
 * Genera el ZIP del paquete para el gestor del periodo pedido (ejercicio + periodo) y lo audita.
 * Incluye los PDF de los modelos fiscales cuyo periodo cae dentro del rango.
 */
export async function generateGestorPackage(input: {
  companyId: string;
  tenantId: string;
  actorUserId: string;
  countryCode: string;
  fiscalYearId: string;
  periodKey: string | null;
}) {
  const { data, year, period } = await loadGestorPackageData(input);
  const zip = await buildGestorPackageZip(data);

  await recordAudit({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "fiscal.gestorPackage",
    entityName: "fiscalYear",
    entityId: year.id,
    payload: { period: period.key, from: period.from, to: data.to, files: zip.fileNames },
  });

  return { bytes: zip.bytes, fileName: gestorPackageFileName(data.companyName, period.label) };
}
