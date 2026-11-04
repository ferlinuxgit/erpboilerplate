import { resolveStatementPeriod, statementPeriodOptions, type StatementPeriod } from "@/server/accounting/statements-model";

/**
 * Periodo de trabajo del portal del asesor: ejercicio + trimestre, mes o año completo (las mismas
 * claves que el paquete para el gestor y los estados financieros). Viaja en la URL (`year`, `period`)
 * para que todas las pantallas y descargas usen el mismo.
 */

export type AdvisorFiscalYear = { id: string; code: string; startsAt: Date; endsAt: Date; isClosed: boolean };

export type AdvisorPeriod = {
  year: AdvisorFiscalYear;
  period: StatementPeriod;
  /** "YYYY-MM-DD", ambos inclusive. */
  from: string;
  to: string;
  options: Array<{ value: string; label: string }>;
};

const DAY_MS = 86_400_000;

/**
 * Por defecto, el trimestre en que caía la fecha de hace 20 días: en enero (plazo del 4.º trimestre)
 * propone el último trimestre del año anterior; a mitad de trimestre, el trimestre en curso.
 */
export function defaultAdvisorPeriod(years: AdvisorFiscalYear[], today = new Date()) {
  const reference = new Date(today.getTime() - 20 * DAY_MS);
  const year = years.find((candidate) => candidate.startsAt <= reference && reference.getTime() < candidate.endsAt.getTime() + DAY_MS)
    ?? years.filter((candidate) => candidate.startsAt <= reference).at(-1)
    ?? years.at(-1);
  if (!year) return null;
  const monthOffset = (reference.getUTCFullYear() - year.startsAt.getUTCFullYear()) * 12 + reference.getUTCMonth() - year.startsAt.getUTCMonth();
  const quarter = Math.min(4, Math.max(1, Math.floor(monthOffset / 3) + 1));
  return { year, periodKey: `q${quarter}` };
}

export function resolveAdvisorPeriod(years: AdvisorFiscalYear[], query: { year?: string | null; period?: string | null }, today = new Date()): AdvisorPeriod | null {
  const fallback = defaultAdvisorPeriod(years, today);
  if (!fallback) return null;
  const requestedYear = query.year ? years.find((candidate) => candidate.id === query.year) : undefined;
  const year = requestedYear ?? fallback.year;
  const periodKey = query.period ?? (requestedYear && requestedYear.id !== fallback.year.id ? "year" : fallback.periodKey);
  const period = resolveStatementPeriod(year, periodKey);
  return {
    year,
    period,
    from: period.from.toISOString().slice(0, 10),
    to: new Date(period.toExclusive.getTime() - DAY_MS).toISOString().slice(0, 10),
    options: statementPeriodOptions(year),
  };
}

/** `year=…&period=…` para enlazar pantallas y descargas del mismo periodo. */
export function advisorPeriodQuery(period: Pick<AdvisorPeriod, "year" | "period">, extra: Record<string, string | null | undefined> = {}) {
  const params = new URLSearchParams({ year: period.year.id, period: period.period.key });
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  return params.toString();
}
