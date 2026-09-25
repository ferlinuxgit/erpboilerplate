/**
 * Vencimientos de facturas (código puro, también usable en cliente).
 *
 * - El vencimiento por defecto es la fecha de emisión + los días de pago del cliente (o los de la
 *   empresa si el cliente no tiene). 0 días = al contado (vence el mismo día).
 * - Las fechas de formulario son "AAAA-MM-DD" en la zona horaria del usuario (Europe/Madrid):
 *   nunca se calcula "hoy" en UTC, que a partir de las 22:00/23:00 ya es el día siguiente.
 */

export const DEFAULT_TIME_ZONE = "Europe/Madrid";
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "AAAA-MM-DD" de una fecha en la zona horaria indicada. */
export function dateInputInTimeZone(date: Date, timeZone = DEFAULT_TIME_ZONE) {
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Hoy como "AAAA-MM-DD" en la zona horaria del usuario (por defecto, España peninsular). */
export function todayDateInput(timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  return dateInputInTimeZone(now, timeZone);
}

function dateInputToUtcMs(value: string) {
  const match = DATE_INPUT.exec(value.trim());
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : ms;
}

/** Suma días a una fecha "AAAA-MM-DD" (sin problemas de horario de verano). "" si no es válida. */
export function addDaysToDateInput(value: string, days: number) {
  const ms = dateInputToUtcMs(value);
  if (ms === null || !Number.isFinite(days)) return "";
  return new Date(ms + Math.trunc(days) * DAY_MS).toISOString().slice(0, 10);
}

/** Días de pago efectivos: los del cliente o, si no tiene, los de la empresa (30 por defecto). */
export function effectivePaymentTermsDays(customerDays: number | null | undefined, companyDays?: number | null) {
  if (typeof customerDays === "number" && Number.isFinite(customerDays) && customerDays >= 0) return Math.trunc(customerDays);
  if (typeof companyDays === "number" && Number.isFinite(companyDays) && companyDays >= 0) return Math.trunc(companyDays);
  return DEFAULT_PAYMENT_TERMS_DAYS;
}

/** Vencimiento del formulario: fecha de emisión + días de pago. */
export function defaultDueDateInput(issueDate: string, termsDays: number) {
  return addDaysToDateInput(issueDate, termsDays);
}

/** Vencimiento en servidor para una fecha de emisión (conserva la hora de la emisión). */
export function computeDueDate(issueDate: Date, termsDays: number) {
  return new Date(issueDate.getTime() + Math.max(Math.trunc(termsDays), 0) * DAY_MS);
}

export type DueDateStatus = {
  kind: "future" | "today" | "overdue";
  /** Días hasta el vencimiento (futuro) o desde el vencimiento (vencida). 0 si vence hoy. */
  days: number;
  label: string;
  tone: "neutral" | "warning" | "danger";
};

function plural(days: number) {
  return `${days} ${days === 1 ? "día" : "días"}`;
}

/**
 * "Vence en 5 días", "Vence hoy", "Vencida hace 1 día". Compara días naturales en la zona horaria
 * del usuario. `today` es "AAAA-MM-DD" (por defecto, hoy en Europe/Madrid).
 */
export function describeDueDate(dueDate: Date | string, options: { today?: string; timeZone?: string } = {}): DueDateStatus | null {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const dueInput = typeof dueDate === "string" && DATE_INPUT.test(dueDate)
    ? dueDate
    : dateInputInTimeZone(dueDate instanceof Date ? dueDate : new Date(dueDate), timeZone);
  const dueMs = dateInputToUtcMs(dueInput);
  const todayMs = dateInputToUtcMs(options.today ?? todayDateInput(timeZone));
  if (dueMs === null || todayMs === null) return null;
  const diff = Math.round((dueMs - todayMs) / DAY_MS);
  if (diff === 0) return { kind: "today", days: 0, label: "Vence hoy", tone: "warning" };
  if (diff > 0) return { kind: "future", days: diff, label: `Vence en ${plural(diff)}`, tone: diff <= 7 ? "warning" : "neutral" };
  return { kind: "overdue", days: -diff, label: `Vencida hace ${plural(-diff)}`, tone: "danger" };
}

/** Texto de plazo para formularios: "Al contado" o "30 días". */
export function paymentTermsLabel(days: number) {
  return days === 0 ? "al contado" : plural(days);
}
