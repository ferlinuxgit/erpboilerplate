/**
 * Cuadro de amortización lineal (funciones puras, importes en céntimos enteros, fechas AAAA-MM-DD).
 *
 * Reglas:
 * - Cuota anual = valor amortizable (adquisición − residual) × porcentaje anual.
 * - Prorrateo por días: cada ejercicio amortiza cuota anual × días en uso ÷ días de un año completo
 *   contado desde el inicio del ejercicio (365 o 366). Un ejercicio de 12 meses completo amortiza
 *   exactamente la cuota anual; uno corto (alta de la empresa a mitad de año) o el primero del bien,
 *   su parte proporcional.
 * - El reparto mensual sigue los mismos días (enero pesa 31, febrero 28), y la suma de los meses
 *   coincide siempre con la cuota del ejercicio: se calcula el acumulado a cada fin de mes y la
 *   cuota es la diferencia con el acumulado anterior, así el redondeo nunca se desvía más de un céntimo.
 * - El último periodo se ajusta para no pasar del valor amortizable.
 */

const DAY_MS = 86_400_000;
const MAX_SCHEDULE_YEARS = 250;
const EPSILON = 1e-9;

export type FiscalRange = { start: string; end: string; code?: string };

export type DepreciationFrequency = "monthly" | "annual";

export type ScheduleMonth = {
  /** Primer y último día amortizados del mes (dentro del ejercicio y de la vida del bien). */
  start: string;
  end: string;
  days: number;
  amountCents: number;
  accumulatedCents: number;
};

export type ScheduleYear = {
  /** Etiqueta del ejercicio: su código si existe en la empresa, o el año. */
  label: string;
  /** Límites del ejercicio contable. */
  fiscalStart: string;
  fiscalEnd: string;
  /** Primer día amortizado dentro del ejercicio. */
  start: string;
  /** Fecha de la dotación anual: fin del ejercicio o fecha de baja. */
  end: string;
  days: number;
  amountCents: number;
  accumulatedCents: number;
  /** Valor amortizable que queda por amortizar al terminar el ejercicio. */
  remainingCents: number;
  months: ScheduleMonth[];
};

export type DepreciationSchedule = {
  depreciableCents: number;
  priorAccumulatedCents: number;
  /** Amortización acumulada al final del cuadro (incluye la anterior al programa). */
  totalCents: number;
  years: ScheduleYear[];
};

export type ScheduleInput = {
  /** Valor amortizable: valor de adquisición − valor residual. */
  depreciableCents: number;
  /** Porcentaje anual (para vida útil en años: 100 ÷ años). */
  annualPct: number;
  /** Primer día que amortiza (puesta en funcionamiento, o inicio en el programa). */
  startDate: string;
  /** Último día que amortiza (fecha de baja), incluido. */
  endDate?: string | null;
  /** Amortización acumulada anterior a `startDate` (bienes que ya venían amortizándose). */
  priorAccumulatedCents?: number;
  /** Ejercicios de la empresa. Fuera de ellos se suponen ejercicios de 12 meses consecutivos. */
  fiscalYears?: readonly FiscalRange[];
};

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dayToIso(isoToDay(value)) === value;
}

export function isoToDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Fecha (00:00 UTC) de un día AAAA-MM-DD: así se guardan las fechas de los asientos y ejercicios. */
export function isoToDate(iso: string): Date {
  return new Date(isoToDay(iso) * DAY_MS);
}

export function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 2026-03-31 → 31/03/2026 (sin pasar por `Date`, para que no dependa de la zona horaria). */
export function formatIsoDate(iso: string | null | undefined): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}

export function addDays(iso: string, days: number): string {
  return dayToIso(isoToDay(iso) + days);
}

function addMonths(day: number, months: number): number {
  const date = new Date(day * DAY_MS);
  return Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()) / DAY_MS);
}

function monthEnd(day: number): number {
  const date = new Date(day * DAY_MS);
  return Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0) / DAY_MS);
}

type DayRange = { start: number; end: number; code?: string };

/** Ejercicio que contiene `day`: el de la empresa o, fuera de los conocidos, uno de 12 meses contiguo. */
function fiscalRangeFor(known: DayRange[], day: number): DayRange {
  if (known.length === 0) {
    const year = new Date(day * DAY_MS).getUTCFullYear();
    return { start: Math.round(Date.UTC(year, 0, 1) / DAY_MS), end: Math.round(Date.UTC(year, 11, 31) / DAY_MS) };
  }
  const first = known[0];
  const last = known[known.length - 1];
  if (day < first.start) {
    let end = first.start - 1;
    let start = addMonths(end + 1, -12);
    while (day < start) {
      end = start - 1;
      start = addMonths(end + 1, -12);
    }
    return { start, end };
  }
  if (day > last.end) {
    let start = last.end + 1;
    let end = addMonths(start, 12) - 1;
    while (day > end) {
      start = end + 1;
      end = addMonths(start, 12) - 1;
    }
    return { start, end };
  }
  for (let index = 0; index < known.length; index += 1) {
    const range = known[index];
    if (day >= range.start && day <= range.end) return range;
    const next = known[index + 1];
    // Hueco entre dos ejercicios (no debería existir): se trata como un periodo propio.
    if (next && day > range.end && day < next.start) return { start: range.end + 1, end: next.start - 1 };
  }
  return last;
}

function normalizeFiscalYears(fiscalYears: readonly FiscalRange[] | undefined): DayRange[] {
  const ranges = (fiscalYears ?? [])
    .filter((range) => isIsoDate(range.start) && isIsoDate(range.end) && range.start <= range.end)
    .map((range) => ({ start: isoToDay(range.start), end: isoToDay(range.end), code: range.code }))
    .sort((left, right) => left.start - right.start);
  // Sin solapes: un ejercicio que empieza antes de que acabe el anterior se descarta.
  const clean: DayRange[] = [];
  for (const range of ranges) {
    if (clean.length === 0 || range.start > clean[clean.length - 1].end) clean.push(range);
  }
  return clean;
}

function rangeLabel(range: DayRange): string {
  if (range.code) return range.code;
  const startYear = new Date(range.start * DAY_MS).getUTCFullYear();
  const endYear = new Date(range.end * DAY_MS).getUTCFullYear();
  return startYear === endYear ? String(startYear) : `${startYear}/${String(endYear).slice(2)}`;
}

export function buildDepreciationSchedule(input: ScheduleInput): DepreciationSchedule {
  const depreciableCents = Math.max(0, Math.trunc(input.depreciableCents));
  const priorAccumulatedCents = Math.min(Math.max(0, Math.trunc(input.priorAccumulatedCents ?? 0)), depreciableCents);
  const empty: DepreciationSchedule = { depreciableCents, priorAccumulatedCents, totalCents: priorAccumulatedCents, years: [] };
  const pct = input.annualPct;
  if (!Number.isFinite(pct) || pct <= 0 || depreciableCents === 0 || priorAccumulatedCents >= depreciableCents) return empty;
  if (!isIsoDate(input.startDate)) return empty;

  const startDay = isoToDay(input.startDate);
  const endDay = input.endDate && isIsoDate(input.endDate) ? isoToDay(input.endDate) : Number.POSITIVE_INFINITY;
  if (endDay < startDay) return empty;

  const known = normalizeFiscalYears(input.fiscalYears);
  const annualExact = (depreciableCents * pct) / 100;
  const years: ScheduleYear[] = [];
  let elapsedYears = 0;
  let accumulated = priorAccumulatedCents;
  let range = fiscalRangeFor(known, startDay);

  for (let guard = 0; guard < MAX_SCHEDULE_YEARS; guard += 1) {
    const fullYearDays = addMonths(range.start, 12) - range.start;
    const from = Math.max(range.start, startDay);
    const to = Math.min(range.end, endDay);
    const months: ScheduleMonth[] = [];
    const accumulatedBefore = accumulated;
    let daysInYear = 0;
    let cursor = from;
    while (cursor <= to) {
      const segmentEnd = Math.min(monthEnd(cursor), to);
      const days = segmentEnd - cursor + 1;
      daysInYear += days;
      const elapsedNow = elapsedYears + daysInYear / fullYearDays;
      const finished = (elapsedNow * pct) / 100 >= 1 - EPSILON;
      const target = finished
        ? depreciableCents
        : Math.max(accumulated, Math.min(depreciableCents, priorAccumulatedCents + Math.round(annualExact * elapsedNow)));
      months.push({ start: dayToIso(cursor), end: dayToIso(segmentEnd), days, amountCents: target - accumulated, accumulatedCents: target });
      accumulated = target;
      cursor = segmentEnd + 1;
      if (accumulated >= depreciableCents) break;
    }
    elapsedYears += daysInYear / fullYearDays;
    if (months.length > 0) {
      years.push({
        label: rangeLabel(range),
        fiscalStart: dayToIso(range.start),
        fiscalEnd: dayToIso(range.end),
        start: dayToIso(from),
        end: dayToIso(to),
        days: daysInYear,
        amountCents: accumulated - accumulatedBefore,
        accumulatedCents: accumulated,
        remainingCents: depreciableCents - accumulated,
        months,
      });
    }
    if (accumulated >= depreciableCents || range.end >= endDay) break;
    range = fiscalRangeFor(known, range.end + 1);
  }

  return { depreciableCents, priorAccumulatedCents, totalCents: accumulated, years };
}

/** `fiscalEnd`: último día del ejercicio contable al que pertenece el periodo. */
export type PostingPeriod = { start: string; end: string; targetCents: number; label: string; fiscalEnd: string };

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function monthLabel(iso: string): string {
  return `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
}

/** Periodos que se contabilizan: cada mes o cada ejercicio, con el acumulado que debe quedar al cerrarlos. */
export function postingPeriods(schedule: DepreciationSchedule, frequency: DepreciationFrequency): PostingPeriod[] {
  if (frequency === "annual") {
    return schedule.years.map((year) => ({ start: year.start, end: year.end, targetCents: year.accumulatedCents, label: `ejercicio ${year.label}`, fiscalEnd: year.fiscalEnd }));
  }
  return schedule.years.flatMap((year) =>
    year.months.map((month) => ({ start: month.start, end: month.end, targetCents: month.accumulatedCents, label: monthLabel(month.end), fiscalEnd: year.fiscalEnd })),
  );
}

export type PendingPosting = { start: string; end: string; amountCents: number; label: string; fiscalEnd: string };

/**
 * Dotaciones pendientes hasta `until` (incluido). `postedThrough` es el último día ya contabilizado y
 * `postedCents` el acumulado contabilizado (incluida la amortización anterior al programa). El primer
 * periodo pendiente absorbe cualquier diferencia con lo ya contabilizado, de modo que el acumulado
 * nunca se duplica ni se queda corto aunque cambie la periodicidad.
 */
export function pendingPostings(
  periods: readonly PostingPeriod[],
  state: { postedThrough: string | null; postedCents: number; until: string },
): PendingPosting[] {
  const pending: PendingPosting[] = [];
  let accumulated = state.postedCents;
  for (const period of periods) {
    if (state.postedThrough && period.end <= state.postedThrough) continue;
    if (period.end > state.until) break;
    const amountCents = period.targetCents - accumulated;
    if (amountCents <= 0) continue;
    const start = state.postedThrough && period.start <= state.postedThrough ? addDays(state.postedThrough, 1) : period.start;
    pending.push({ start, end: period.end, amountCents, label: period.label, fiscalEnd: period.fiscalEnd });
    accumulated = period.targetCents;
  }
  return pending;
}
