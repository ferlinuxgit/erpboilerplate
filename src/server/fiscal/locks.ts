import { and, eq, sql } from "drizzle-orm";

import { company, fiscalReport, fiscalYear } from "@/db/schema";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import { FISCAL_TIME_ZONE_CANARY, FISCAL_TIME_ZONE_PENINSULA, fiscalRangeInstants, fiscalTimeZoneFor, isSpanishFiscalModelCode, parseSpanishFiscalPeriod } from "@/lib/fiscal-spain";
import type { DbClient } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";
import { ACCRUAL_LOCKING_MODEL_CODES } from "@/server/fiscal/accrual";

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

type FiledReportRow = { id: string; code: string; period: string };

/** Primer modelo presentado cuyo periodo contiene la fecha, con los límites en la hora local indicada. */
function lockFor(reports: FiledReportRow[], date: Date, timeZone: string, codes?: ReadonlySet<string>): FiscalLockResult {
  for (const report of reports) {
    if (!isSpanishFiscalModelCode(report.code)) continue;
    if (codes && !codes.has(report.code)) continue;

    const range = parseSpanishFiscalPeriod(report.period, report.code);
    if (!range) continue;

    const instants = fiscalRangeInstants(range, timeZone);
    if (date >= instants.start && date < instants.endExclusive) {
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

/**
 * ¿Cae la fecha en un periodo presentado? Los periodos empiezan y acaban a medianoche local (ver
 * «HORA LOCAL DE LOS PERIODOS FISCALES» en `@/lib/fiscal-spain`), igual que en el cálculo de los
 * modelos: un ticket del 1 de abril a las 00:30 de Madrid ya no choca con el primer trimestre.
 * El territorio de la empresa solo se consulta si península y Canarias dan respuestas distintas
 * (la hora de diferencia entre ambas medianoches).
 */
export async function findFiscalPeriodLock(companyId: string, date: Date, dbClient?: DbClient, codes?: ReadonlySet<string>): Promise<FiscalLockResult> {
  const client = dbClient ?? (await import("@/lib/db")).db;
  const reports = await client
    .select({
      id: fiscalReport.id,
      code: fiscalReport.code,
      period: fiscalReport.period,
    })
    .from(fiscalReport)
    .where(and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.status, "FILED")));

  const peninsula = lockFor(reports, date, FISCAL_TIME_ZONE_PENINSULA, codes);
  const canary = lockFor(reports, date, FISCAL_TIME_ZONE_CANARY, codes);
  if (peninsula.locked === canary.locked && peninsula.reportId === canary.reportId) return peninsula;
  // Mismo criterio que `getCompanyTaxTerritory`, con el cliente recibido (puede ser una transacción).
  const companies = await client
    .select({ countryCode: company.countryCode, postalCode: company.postalCode, province: company.province })
    .from(company)
    .where(eq(company.id, companyId));
  return fiscalTimeZoneFor(taxTerritoryOf(companies[0]) ?? "ES") === FISCAL_TIME_ZONE_CANARY ? canary : peninsula;
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

/**
 * Fecha de operación de una factura emitida: avisa si cae en un periodo de IVA/IGIC ya presentado
 * (303, 390, 420 o 425) distinto del de expedición. El IVA se devenga en la fecha de operación, así
 * que esa factura pertenece a un modelo que ya no se puede cambiar sin una complementaria.
 *
 * Pensada para llamarse al emitir, después de `assertFiscalPeriodOpen(companyId, issueDate)`. Si no
 * se llama, el cálculo sigue siendo seguro: `resolveAccrualDate` imputa esas facturas al periodo de
 * expedición y el modelo lo avisa.
 */
export async function assertOperationDatePeriodOpen(companyId: string, operationDate: Date | null | undefined, issueDate: Date, dbClient?: DbClient) {
  if (!operationDate || Number.isNaN(operationDate.getTime()) || operationDate >= issueDate) return;
  const lock = await findFiscalPeriodLock(companyId, operationDate, dbClient, ACCRUAL_LOCKING_MODEL_CODES);
  if (!lock.locked) return;
  const issueLock = await findFiscalPeriodLock(companyId, issueDate, dbClient, ACCRUAL_LOCKING_MODEL_CODES);
  if (issueLock.locked && issueLock.reportId === lock.reportId) return;

  throw new FiscalPeriodLockedError(
    `La fecha de operación cae en el periodo ${lock.period} del modelo ${lock.code}, que ya está presentado. Si la operación es de ese periodo, reabre el modelo en Fiscalidad (habrá que presentar una complementaria); si no, corrige la fecha de operación.`,
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
