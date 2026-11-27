import { and, eq, sql } from "drizzle-orm";

import { accountChart, journalEntry, journalLine } from "@/db/schema";
import { db } from "@/lib/db";
import { accountingRange, loadCompanyTimeZone, postedBeforeSql } from "@/server/accounting/fiscal-year-date";
import { toCents } from "@/server/accounting/money";
import { buildFinancialStatements, groupTrialBalance, type StatementAccountRow } from "@/server/accounting/statements-model";

/** Asientos del ciclo de ejercicio (mismos valores que `FISCAL_YEAR_SOURCE`). */
const LIFECYCLE_SOURCES = ["fiscalYearRegularization", "fiscalYearClosing", "fiscalYearOpening"] as const;
const CLOSING_OPENING_SOURCES = ["fiscalYearClosing", "fiscalYearOpening"] as const;

function sourceIn(values: readonly string[]) {
  return sql`coalesce(${journalEntry.sourceType}, '') in (${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;
}

/**
 * Saldos por cuenta para los estados financieros de un periodo.
 * Una sola consulta agregada: saldo anterior, debe/haber del periodo y acumulado del ejercicio.
 *
 * Los límites del rango son fechas civiles (00:00 UTC) y se aplican en la hora local de la empresa
 * (ver `fiscal-year-date.ts`): un ticket del 1 de enero a las 00:30 de Madrid es del ejercicio nuevo.
 */
export async function loadStatementAccountRows(
  companyId: string,
  range: { yearStart: Date; from: Date; toExclusive: Date },
  timeZone?: string,
): Promise<StatementAccountRow[]> {
  const zone = timeZone ?? (await loadCompanyTimeZone(db, companyId));
  const period = accountingRange({ from: range.from, toExclusive: range.toExclusive }, zone);
  const year = accountingRange({ from: range.yearStart, toExclusive: range.toExclusive }, zone);
  const beforeFrom = postedBeforeSql(period, "from");
  const beforeEnd = postedBeforeSql(period, "toExclusive");
  const inPeriod = sql`(not ${beforeFrom} and ${beforeEnd})`;
  const inYear = sql`(not ${postedBeforeSql(year, "from")} and ${beforeEnd})`;
  const excludeClosing = sql`not ${sourceIn(CLOSING_OPENING_SOURCES)}`;
  const excludeLifecycle = sql`not ${sourceIn(LIFECYCLE_SOURCES)}`;
  const net = sql`(${journalLine.debit} - ${journalLine.credit})`;
  const rows = await db
    .select({
      accountId: accountChart.id,
      code: accountChart.code,
      name: accountChart.name,
      type: accountChart.type,
      prior: sql<string>`coalesce(sum(case when ${beforeFrom} and ${excludeClosing} then ${net} else 0 end), 0)`,
      debit: sql<string>`coalesce(sum(case when ${inPeriod} and ${excludeLifecycle} then ${journalLine.debit} else 0 end), 0)`,
      credit: sql<string>`coalesce(sum(case when ${inPeriod} and ${excludeLifecycle} then ${journalLine.credit} else 0 end), 0)`,
      yearToDate: sql<string>`coalesce(sum(case when ${inYear} and ${excludeLifecycle} then ${net} else 0 end), 0)`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, and(eq(accountChart.id, journalLine.accountId), eq(accountChart.companyId, companyId)))
    .where(and(eq(journalEntry.companyId, companyId), beforeEnd))
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
  const [rows, groupNames] = await Promise.all([
    loadStatementAccountRows(companyId, range),
    db
      .select({ code: accountChart.code, name: accountChart.name })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, companyId), sql`length(${accountChart.code}) = 3`)),
  ]);
  const statements = buildFinancialStatements(rows, countryCode);
  return {
    ...statements,
    /** Saldos por cuenta de los que salen los estados (para el modelo oficial abreviado). */
    rows,
    // Sumas y saldos con subtotales por cuenta de 3 dígitos (clientes 430 con todas sus subcuentas…).
    trialBalanceGroups: groupTrialBalance(statements.trialBalance, new Map(groupNames.map((row) => [row.code, row.name]))),
  };
}
