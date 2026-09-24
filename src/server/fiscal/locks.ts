import { and, eq, sql } from "drizzle-orm";

import { fiscalReport, fiscalYear } from "@/db/schema";
import { isSpanishFiscalModelCode, parseSpanishFiscalPeriod } from "@/lib/fiscal-spain";
import type { DbClient } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";

export type FiscalLockResult = {
  locked: boolean;
  reportId?: string;
  code?: string;
  period?: string;
};

/** Periodo presentado a la AEAT: no admite nuevos apuntes con fecha dentro de él. */
export class FiscalPeriodLockedError extends AccountingRuleError {
  constructor(message: string) {
    super(409, "FISCAL_PERIOD_LOCKED", message);
    this.name = "FiscalPeriodLockedError";
  }
}

/** Ejercicio cerrado o inexistente para la fecha indicada. */
export class FiscalYearUnavailableError extends AccountingRuleError {
  constructor(code: "FISCAL_YEAR_CLOSED" | "FISCAL_YEAR_MISSING" | "INVALID_DATE", message: string) {
    super(code === "FISCAL_YEAR_CLOSED" ? 409 : 422, code, message);
    this.name = "FiscalYearUnavailableError";
  }
}

/**
 * `fiscal_year.endsAt` se guarda como el último día del ejercicio a las 00:00 UTC.
 * El ejercicio cubre ese día completo, así que el límite es exclusivo al día siguiente.
 */
export function fiscalYearEndExclusive(endsAt: Date) {
  return new Date(Date.UTC(endsAt.getUTCFullYear(), endsAt.getUTCMonth(), endsAt.getUTCDate() + 1));
}

export async function findFiscalPeriodLock(companyId: string, date: Date, dbClient?: DbClient): Promise<FiscalLockResult> {
  const client = dbClient ?? (await import("@/lib/db")).db;
  const reports = await client
    .select({
      id: fiscalReport.id,
      code: fiscalReport.code,
      period: fiscalReport.period,
    })
    .from(fiscalReport)
    .where(and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.status, "FILED")));

  for (const report of reports) {
    if (!isSpanishFiscalModelCode(report.code)) continue;

    const range = parseSpanishFiscalPeriod(report.period, report.code);
    if (!range) continue;

    if (date >= range.start && date < range.endExclusive) {
      return {
        locked: true,
        reportId: report.id,
        code: report.code,
        period: report.period,
      };
    }
  }

  return { locked: false };
}

export async function assertFiscalYearOpen(companyId: string, date: Date, dbClient?: DbClient) {
  if (Number.isNaN(date.getTime())) throw new FiscalYearUnavailableError("INVALID_DATE", "La fecha contable no es válida.");
  const client = dbClient ?? (await import("@/lib/db")).db;
  const [year] = await client
    .select({ code: fiscalYear.code, isClosed: fiscalYear.isClosed })
    .from(fiscalYear)
    .where(and(
      eq(fiscalYear.companyId, companyId),
      sql`${date} >= ${fiscalYear.startsAt}`,
      sql`${date} < (${fiscalYear.endsAt} + interval '1 day')`,
    ))
    .limit(1);
  if (!year) {
    throw new FiscalYearUnavailableError(
      "FISCAL_YEAR_MISSING",
      "La fecha no pertenece a ningún ejercicio abierto de la empresa. Si ya ha empezado un año nuevo, abre el ejercicio siguiente desde Contabilidad.",
    );
  }
  if (year.isClosed) {
    throw new FiscalYearUnavailableError("FISCAL_YEAR_CLOSED", `El ejercicio ${year.code} está cerrado. Usa una fecha de un ejercicio abierto.`);
  }
}

export async function assertFiscalPeriodOpen(companyId: string, date: Date, dbClient?: DbClient) {
  await assertFiscalYearOpen(companyId, date, dbClient);
  const lock = await findFiscalPeriodLock(companyId, date, dbClient);
  if (!lock.locked) return;

  throw new FiscalPeriodLockedError(
    `El periodo fiscal ${lock.period} del modelo ${lock.code} ya está presentado y bloqueado. Usa una fecha posterior o reabre el modelo en Fiscalidad.`,
  );
}

/** Devuelve `preferred` si su periodo está abierto; si no, `fallback` (que debe estarlo). */
export async function resolveOpenPostingDate(companyId: string, preferred: Date, fallback: Date, dbClient?: DbClient) {
  try {
    await assertFiscalPeriodOpen(companyId, preferred, dbClient);
    return preferred;
  } catch (error) {
    if (!(error instanceof AccountingRuleError)) throw error;
    await assertFiscalPeriodOpen(companyId, fallback, dbClient);
    return fallback;
  }
}
