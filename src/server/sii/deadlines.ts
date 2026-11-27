/**
 * Plazo legal del SII (art. 69 bis RIVA). Código puro sobre fechas civiles (año, mes, día).
 *
 * - Facturas expedidas: cuatro días naturales desde la expedición y, en todo caso, antes del día
 *   16 del mes siguiente al del devengo.
 * - Facturas recibidas: cuatro días naturales desde el registro contable y, en todo caso, antes
 *   del día 16 del mes siguiente al periodo de liquidación en que se incluyen.
 * - Del cómputo se excluyen sábados, domingos y los declarados festivos nacionales.
 *
 * FESTIVOS: se toman las fiestas de ámbito nacional de fecha fija y el Viernes Santo. El
 * calendario de cada año lo fija una resolución anual publicada en el BOE; aquí NO se contrasta
 * con ella. Si un año difiere, se corrige con SII_EXTRA_HOLIDAYS (fechas AAAA-MM-DD separadas por
 * comas) o pasando `extraHolidays`.
 */

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

/** Domingo de Pascua (algoritmo gregoriano anónimo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

/** Fiestas de ámbito nacional de fecha fija (mes, día). */
const FIXED_NATIONAL_HOLIDAYS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], // Año Nuevo
  [1, 6], // Epifanía del Señor
  [5, 1], // Fiesta del Trabajo
  [8, 15], // Asunción de la Virgen
  [10, 12], // Fiesta Nacional de España
  [11, 1], // Todos los Santos
  [12, 6], // Día de la Constitución
  [12, 8], // Inmaculada Concepción
  [12, 25], // Natividad del Señor
];

/** Festivos nacionales de un año (claves AAAA-MM-DD): los de fecha fija y el Viernes Santo. */
export function nationalHolidays(year: number): Set<string> {
  const holidays = new Set(FIXED_NATIONAL_HOLIDAYS.map(([month, day]) => civilKey({ year, month, day })));
  holidays.add(civilKey(addCivilDays(easterSunday(year), -2)));
  return holidays;
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
