import { and, asc, eq, gte, lt } from "drizzle-orm";

import { accountChart, company, journalEntry, journalLine } from "@/db/schema";
import { db } from "@/lib/db";
import { isSpanishFiscalModelCode, parseSpanishFiscalPeriod } from "@/lib/fiscal-spain";
import { journalEntryOriginLabel } from "@/lib/status-labels";
import { AccountingRuleError } from "@/server/accounting/errors";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { buildGestorPackageZip, gestorPackageFileName, type GestorJournalLine } from "@/server/accounting/gestor-package-model";
import { toCents } from "@/server/accounting/money";
import { loadStatementAccountRows } from "@/server/accounting/statements";
import { buildFinancialStatements, resolveStatementPeriod } from "@/server/accounting/statements-model";
import { recordAudit } from "@/server/audit";
import { listFiscalReports } from "@/server/fiscal/service";
import { calculateSpanishFiscalSummary, loadVatRegisters } from "@/server/fiscal/spain";
import { renderFiscalReportPdf } from "@/server/pdf/render";

async function loadJournalLines(companyId: string, from: Date, toExclusive: Date): Promise<GestorJournalLine[]> {
  const rows = await db
    .select({
      entryId: journalEntry.id,
      number: journalEntry.number,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
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
    .orderBy(asc(journalEntry.postedAt), asc(journalEntry.number), asc(journalLine.id));
  // Dentro de cada asiento, primero las líneas al debe (presentación habitual del libro diario).
  return rows.map((row) => ({
    entryId: row.entryId,
    number: row.number,
    postedAt: row.postedAt,
    reference: row.reference,
    origin: journalEntryOriginLabel(row),
    accountCode: row.accountCode,
    accountName: row.accountName,
    debit: toCents(row.debit) / 100,
    credit: toCents(row.credit) / 100,
  })).sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.number.localeCompare(b.number) || b.debit - a.debit);
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
  const years = await listFiscalYears(input.companyId);
  const year = years.find((candidate) => candidate.id === input.fiscalYearId);
  if (!year) throw new AccountingRuleError(404, "FISCAL_YEAR_NOT_FOUND", "Ejercicio no encontrado.");
  const period = resolveStatementPeriod(year, input.periodKey);
  const to = new Date(period.toExclusive.getTime() - 86_400_000);

  const [[companyRow], journal, statementRows, vat, reports] = await Promise.all([
    db.select({ name: company.name, vatNumber: company.vatNumber }).from(company).where(eq(company.id, input.companyId)).limit(1),
    loadJournalLines(input.companyId, period.from, period.toExclusive),
    loadStatementAccountRows(input.companyId, { yearStart: year.startsAt, from: period.from, toExclusive: period.toExclusive }),
    loadVatRegisters(input.companyId, period.from, period.toExclusive),
    listFiscalReports(input.companyId),
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
    const summary = await calculateSpanishFiscalSummary(input.companyId, report.code, report.period);
    const pdf = await renderFiscalReportPdf({ companyName, summary });
    modelPdfs.push({ fileName: `modelo-${report.code}-${report.period}.pdf`, bytes: new Uint8Array(pdf) });
  }

  const generatedAt = new Date();
  const zip = await buildGestorPackageZip({
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
    modelPdfs,
    generatedAt,
  });

  await recordAudit({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "fiscal.gestorPackage",
    entityName: "fiscalYear",
    entityId: year.id,
    payload: { period: period.key, from: period.from, to, files: zip.fileNames },
  });

  return { bytes: zip.bytes, fileName: gestorPackageFileName(companyName, period.label) };
}
