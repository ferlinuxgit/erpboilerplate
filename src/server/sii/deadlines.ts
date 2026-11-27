/**
 * Plazo legal del SII (art. 69 bis RIVA). Código puro sobre fechas civiles (año, mes, día).
 *
 * - Facturas expedidas: cuatro días naturales desde la expedición y, en todo caso, antes del día
 *   16 del mes siguiente al del devengo.
 * - Facturas recibidas: cuatro días naturales desde el registro contable y, en todo caso, antes
 *   del día 16 del mes siguiente al periodo de liquidación en que se incluyen.
 * - Del cómputo se excluyen sábados, domingos y los declarados festivos nacionales.
 *
 * FESTIVOS: los de ámbito nacional de `@/lib/spanish-holidays` (los no sustituibles y, en los años
 * contrastados con la resolución anual del BOE, el 6 de enero). Los autonómicos y locales no
 * excluyen días del plazo del SII. Si un año hiciera falta añadir alguno, se corrige con
 * SII_EXTRA_HOLIDAYS (fechas AAAA-MM-DD separadas por comas) o pasando `extraHolidays`.
 */

import { easterSunday, spanishNationalHolidayKeys } from "@/lib/spanish-holidays";

export { easterSunday };

export type CivilDate = { year: number; month: number; day: number };

export const SII_DEADLINE_BUSINESS_DAYS = 4;

const pad = (value: number) => String(value).padStart(2, "0");

export function civilKey(date: CivilDate) {
  return `${String(date.year).padStart(4, "0")}-${pad(date.month)}-${pad(date.day)}`;
}

function toUtc(date: CivilDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function fromUtc(date: Date): CivilDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const utc = toUtc(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtc(utc);
}

export function compareCivil(left: CivilDate, right: CivilDate) {
  return civilKey(left).localeCompare(civilKey(right));
}

/** Festivos nacionales de un año (claves AAAA-MM-DD). */
export function nationalHolidays(year: number): Set<string> {
  return spanishNationalHolidayKeys(year);
}

/** Festivos añadidos por configuración (SII_EXTRA_HOLIDAYS=2027-03-19,2027-04-01). */
export function parseExtraHolidays(value: string | null | undefined): string[] {
  return (value ?? "").split(/[\s,;]+/).map((entry) => entry.trim()).filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
}

export function isSiiBusinessDay(date: CivilDate, extraHolidays: Iterable<string> = []) {
  const weekday = toUtc(date).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const key = civilKey(date);
  if (nationalHolidays(date.year).has(key)) return false;
  for (const holiday of extraHolidays) if (holiday === key) return false;
  return true;
}

/** Fecha que resulta de contar `days` días hábiles del SII a partir del día siguiente a `start`. */
export function addSiiBusinessDays(start: CivilDate, days: number, extraHolidays: Iterable<string> = []): CivilDate {
  const holidays = [...extraHolidays];
  let current = start;
  let remaining = days;
  while (remaining > 0) {
    current = addCivilDays(current, 1);
    if (isSiiBusinessDay(current, holidays)) remaining -= 1;
  }
  return current;
}

/** Día 15 del mes siguiente al de la fecha: el último día válido del «antes del día 16». */
export function fifteenthOfNextMonth(date: CivilDate): CivilDate {
  return date.month === 12 ? { year: date.year + 1, month: 1, day: 15 } : { year: date.year, month: date.month + 1, day: 15 };
}

/**
 * Último día para suministrar un registro.
 * `start`: expedición (expedidas) o registro contable (recibidas).
 * `accrual`: devengo (expedidas: fecha de operación o, sin ella, de expedición) o fecha del periodo
 * de liquidación en que se incluye (recibidas: la de registro contable).
 */
export function siiDeadline(input: { start: CivilDate; accrual?: CivilDate | null; extraHolidays?: Iterable<string> }): CivilDate {
  const byDays = addSiiBusinessDays(input.start, SII_DEADLINE_BUSINESS_DAYS, input.extraHolidays ?? []);
  const cap = fifteenthOfNextMonth(input.accrual ?? input.start);
  return compareCivil(byDays, cap) <= 0 ? byDays : cap;
}

export type SiiDeadlineStatus = "on-time" | "due-soon" | "overdue";

/** Situación de un registro aún no aceptado respecto a su plazo (vence hoy o mañana = «due-soon»). */
export function siiDeadlineStatus(deadline: CivilDate, today: CivilDate): SiiDeadlineStatus {
  if (compareCivil(today, deadline) > 0) return "overdue";
  return compareCivil(addCivilDays(today, 1), deadline) >= 0 ? "due-soon" : "on-time";
}

export function parseCivilKey(key: string | null | undefined): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? "");
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

/** «15/04/2027». */
export function formatCivil(date: CivilDate) {
  return `${pad(date.day)}/${pad(date.month)}/${date.year}`;
}
