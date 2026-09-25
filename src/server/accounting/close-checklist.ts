import { and, count, eq, gte, lt, sql } from "drizzle-orm";

import { accountChart, bankAccount, bankTransaction, companySettings, fiscalReport, fiscalYear, invoice, journalEntry, journalLine } from "@/db/schema";
import { db } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";
import { evaluateCloseChecklist, type CloseChecklist } from "@/server/accounting/close-checklist-model";
import { toCents } from "@/server/accounting/money";
import { fiscalYearEndExclusive } from "@/server/fiscal/locks";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Último periodo de IVA del ejercicio: el trimestre (o mes) que contiene su último día. */
export function lastVatPeriodOfYear(endsAt: Date, periodicity: "monthly" | "quarterly") {
  const year = endsAt.getUTCFullYear();
  const month = endsAt.getUTCMonth() + 1;
  if (periodicity === "monthly") {
    return { period: `${year}-${String(month).padStart(2, "0")}`, label: `mes de ${MONTHS[month - 1]} de ${year}` };
  }
  const quarter = Math.floor((month - 1) / 3) + 1;
  return { period: `${year}-Q${quarter}`, label: `${quarter}.º trimestre de ${year}` };
}

/** Comprobaciones previas al cierre del ejercicio `fiscalYearId` (solo lectura). */
export async function getCloseChecklist(companyId: string, fiscalYearId: string): Promise<CloseChecklist & { yearCode: string }> {
  const [year] = await db
    .select({ id: fiscalYear.id, code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.id, fiscalYearId), eq(fiscalYear.companyId, companyId)))
    .limit(1);
  if (!year) throw new AccountingRuleError(404, "FISCAL_YEAR_NOT_FOUND", "Ejercicio no encontrado.");
  const endExclusive = fiscalYearEndExclusive(year.endsAt);

  const [settings] = await db
    .select({ fiscalRegime: companySettings.fiscalRegime, taxPeriodicity: companySettings.taxPeriodicity })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  const regime = settings?.fiscalRegime ?? "general";
  const filesVat = regime !== "recargo_equivalencia" && regime !== "exempt";
  const vatPeriod = lastVatPeriodOfYear(year.endsAt, settings?.taxPeriodicity === "monthly" ? "monthly" : "quarterly");

  const notClosingOrOpening = sql`coalesce(${journalEntry.sourceType}, '') not in ('fiscalYearClosing', 'fiscalYearOpening')`;
  const [vatReport, drafts, account555, pendingBank, ledger] = await Promise.all([
    filesVat
      ? db
          .select({ id: fiscalReport.id, status: fiscalReport.status })
          .from(fiscalReport)
          .where(and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.code, "303"), eq(fiscalReport.period, vatPeriod.period)))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ value: count() })
      .from(invoice)
      .where(and(eq(invoice.companyId, companyId), eq(invoice.status, "DRAFT"), gte(invoice.issueDate, year.startsAt), lt(invoice.issueDate, endExclusive))),
    db
      .select({ balance: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), 0)` })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
      .where(and(eq(journalEntry.companyId, companyId), lt(journalEntry.postedAt, endExclusive), sql`${accountChart.code} like '555%'`, notClosingOrOpening)),
    db
      .select({ value: count() })
      .from(bankTransaction)
      .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
      .where(and(eq(bankAccount.companyId, companyId), eq(bankTransaction.reconciliationStatus, "PENDING"), lt(bankTransaction.postedAt, endExclusive))),
    db
      .select({
        debit: sql<string>`coalesce(sum(${journalLine.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${journalLine.credit}), 0)`,
      })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .where(and(eq(journalEntry.companyId, companyId), lt(journalEntry.postedAt, endExclusive))),
  ]);

  const report = vatReport[0] ?? null;
  const checklist = evaluateCloseChecklist({
    yearCode: year.code,
    lastVatReturn: filesVat ? { ...vatPeriod, reportId: report?.id ?? null, filed: report?.status === "FILED" } : null,
    draftSalesInvoices: Number(drafts[0]?.value ?? 0),
    account555Cents: toCents(account555[0]?.balance ?? 0),
    pendingBankTransactions: Number(pendingBank[0]?.value ?? 0),
    ledgerDifferenceCents: toCents(ledger[0]?.debit ?? 0) - toCents(ledger[0]?.credit ?? 0),
  });
  return { ...checklist, yearCode: year.code };
}
