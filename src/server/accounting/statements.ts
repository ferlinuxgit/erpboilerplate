import { and, eq, sql } from "drizzle-orm";

import { accountChart, journalEntry, journalLine } from "@/db/schema";
import { db } from "@/lib/db";
import { toCents } from "@/server/accounting/money";
import { buildFinancialStatements, type StatementAccountRow } from "@/server/accounting/statements-model";

/** Asientos del ciclo de ejercicio (mismos valores que `FISCAL_YEAR_SOURCE`). */
const LIFECYCLE_SOURCES = ["fiscalYearRegularization", "fiscalYearClosing", "fiscalYearOpening"] as const;
const CLOSING_OPENING_SOURCES = ["fiscalYearClosing", "fiscalYearOpening"] as const;

function sourceIn(values: readonly string[]) {
  return sql`coalesce(${journalEntry.sourceType}, '') in (${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;
}

/**
 * Saldos por cuenta para los estados financieros de un periodo.
 * Una sola consulta agregada: saldo anterior, debe/haber del periodo y acumulado del ejercicio.
 */
export async function loadStatementAccountRows(
  companyId: string,
  range: { yearStart: Date; from: Date; toExclusive: Date },
): Promise<StatementAccountRow[]> {
  const excludeClosing = sql`not ${sourceIn(CLOSING_OPENING_SOURCES)}`;
  const excludeLifecycle = sql`not ${sourceIn(LIFECYCLE_SOURCES)}`;
  const net = sql`(${journalLine.debit} - ${journalLine.credit})`;
  const rows = await db
    .select({
      accountId: accountChart.id,
      code: accountChart.code,
      name: accountChart.name,
      type: accountChart.type,
      prior: sql<string>`coalesce(sum(case when ${journalEntry.postedAt} < ${range.from} and ${excludeClosing} then ${net} else 0 end), 0)`,
      debit: sql<string>`coalesce(sum(case when ${journalEntry.postedAt} >= ${range.from} and ${journalEntry.postedAt} < ${range.toExclusive} and ${excludeLifecycle} then ${journalLine.debit} else 0 end), 0)`,
      credit: sql<string>`coalesce(sum(case when ${journalEntry.postedAt} >= ${range.from} and ${journalEntry.postedAt} < ${range.toExclusive} and ${excludeLifecycle} then ${journalLine.credit} else 0 end), 0)`,
      yearToDate: sql<string>`coalesce(sum(case when ${journalEntry.postedAt} >= ${range.yearStart} and ${journalEntry.postedAt} < ${range.toExclusive} and ${excludeLifecycle} then ${net} else 0 end), 0)`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, and(eq(accountChart.id, journalLine.accountId), eq(accountChart.companyId, companyId)))
    .where(and(eq(journalEntry.companyId, companyId), sql`${journalEntry.postedAt} < ${range.toExclusive}`))
    .groupBy(accountChart.id, accountChart.code, accountChart.name, accountChart.type)
    .orderBy(accountChart.code);

  return rows.map((row) => ({
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    type: row.type,
    priorCents: toCents(row.prior),
    debitCents: toCents(row.debit),
    creditCents: toCents(row.credit),
    yearToDateCents: toCents(row.yearToDate),
  }));
}

export async function getFinancialStatements(
  companyId: string,
  countryCode: string,
  range: { yearStart: Date; from: Date; toExclusive: Date },
) {
  return buildFinancialStatements(await loadStatementAccountRows(companyId, range), countryCode);
}
