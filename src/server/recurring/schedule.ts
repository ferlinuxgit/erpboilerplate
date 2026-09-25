/**
 * Calendario de documentos recurrentes (sin dependencias de servidor: se usa también en el
 * cliente para previsualizar las próximas fechas). Todas las fechas son de calendario
 * (`YYYY-MM-DD`) en la zona horaria de la empresa; nunca se hace aritmética con horas.
 */

export const RECURRING_FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY", "EVERY_N_MONTHS"] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export function isRecurringFrequency(value: unknown): value is RecurringFrequency {
  return typeof value === "string" && (RECURRING_FREQUENCIES as readonly string[]).includes(value);
}

export const recurringFrequencyLabels: Record<RecurringFrequency, string> = {
  MONTHLY: "Cada mes",
  QUARTERLY: "Cada trimestre",
  YEARLY: "Cada año",
  EVERY_N_MONTHS: "Cada N meses",
};

export type RecurringSchedule = {
  startDate: string;
  /** Día del mes de cada emisión; 29–31 se ajusta al último día en los meses más cortos. */
  dayOfMonth: number;
  intervalMonths: number;
  endDate?: string | null;
  maxOccurrences?: number | null;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateInput(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function intervalForFrequency(frequency: RecurringFrequency, everyMonths?: number | null) {
  if (frequency === "MONTHLY") return 1;
  if (frequency === "QUARTERLY") return 3;
  if (frequency === "YEARLY") return 12;
  const months = Math.trunc(Number(everyMonths ?? 0));
  return months >= 1 && months <= 60 ? months : 1;
}

/**
 * Fecha de la ocurrencia `index` (0 = la primera). Se ancla siempre al mes de inicio y al día
 * elegido, no a la ocurrencia anterior: un 31 de enero mensual da 28/29 feb, 31 mar, 30 abr…
 */
export function occurrenceDate(schedule: Pick<RecurringSchedule, "startDate" | "dayOfMonth" | "intervalMonths">, index: number) {
  const start = parts(schedule.startDate);
  const monthIndex = start.year * 12 + (start.month - 1) + index * schedule.intervalMonths;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const day = Math.min(schedule.dayOfMonth, daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Límite de búsqueda (100 años mensuales): evita bucles infinitos con datos corruptos. */
const MAX_SCAN = 1200;

/** Primera ocurrencia estrictamente posterior a `after` (o la primera desde el inicio si `after` es null). */
function firstOccurrenceAfter(schedule: RecurringSchedule, after: string | null) {
  for (let index = 0; index < MAX_SCAN; index += 1) {
    const date = occurrenceDate(schedule, index);
    if (date < schedule.startDate) continue;
    if (after === null || date > after) return date;
  }
  return null;
}

/**
 * Siguiente fecha a generar después de `lastGenerated` (null = aún no se ha generado ninguna), o
 * null si la recurrencia terminó (fecha final o número máximo de emisiones). Se basa en la última
 * fecha generada y no en un índice, así que editar la periodicidad nunca repite periodos pasados.
 */
export function nextRunAfter(schedule: RecurringSchedule, lastGenerated: string | null, generatedCount: number): string | null {
  if (schedule.maxOccurrences && generatedCount >= schedule.maxOccurrences) return null;
  const date = firstOccurrenceAfter(schedule, lastGenerated);
  if (!date || (schedule.endDate && date > schedule.endDate)) return null;
  return date;
}

/** Próximas `count` fechas a partir de `nextRunDate` (para la vista previa). */
export function upcomingOccurrences(schedule: RecurringSchedule, nextRunDate: string | null, generatedCount: number, count = 3) {
  const dates: string[] = [];
  let next = nextRunDate;
  let generated = generatedCount;
  while (next && dates.length < count) {
    if (schedule.maxOccurrences && generated >= schedule.maxOccurrences) break;
    if (schedule.endDate && next > schedule.endDate) break;
    dates.push(next);
    generated += 1;
    next = nextRunAfter(schedule, next, generated);
  }
  return dates;
}

/** Fechas pendientes de generar hasta `today` inclusive (recupera periodos si el worker estuvo parado). */
export function dueOccurrences(schedule: RecurringSchedule, nextRunDate: string | null, generatedCount: number, today: string, limit = 12) {
  return upcomingOccurrences(schedule, nextRunDate, generatedCount, limit).filter((date) => date <= today);
}

export function addDays(date: string, days: number) {
  const { year, month, day } = parts(date);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** Días naturales entre dos fechas de calendario (b − a). */
export function daysBetween(a: string, b: string) {
  const from = parts(a);
  const to = parts(b);
  return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000);
}

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const TEMPLATE_VARIABLES = [
  { token: "{mes}", help: "mes de la emisión (septiembre)" },
  { token: "{mes_anterior}", help: "mes anterior (agosto)" },
  { token: "{trimestre}", help: "trimestre (3T)" },
  { token: "{año}", help: "año (2026)" },
] as const;

/** Valores de las variables de texto para una fecha de emisión. */
export function periodVariables(date: string) {
  const { year, month } = parts(date);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return {
    mes: MONTH_NAMES[month - 1],
    mes_anterior: MONTH_NAMES[previousMonth - 1],
    año_mes_anterior: String(previousYear),
    trimestre: `${Math.ceil(month / 3)}T`,
    año: String(year),
  } as const;
}

/**
 * Sustituye {mes}, {mes_anterior}, {trimestre} y {año} en un texto. Si la variable se escribe
 * con mayúscula inicial ({Mes}) el valor también la lleva ("Septiembre"). Las llaves
 * desconocidas se dejan tal cual.
 */
export function renderPeriodText(text: string, date: string) {
  const values: Record<string, string> = periodVariables(date);
  return text.replace(/\{([A-Za-zÁÉÍÓÚáéíóúñÑ_]+)\}/g, (match, rawName: string) => {
    const name = rawName.toLowerCase();
    const value = values[name];
    if (value === undefined) return match;
    const capitalized = rawName[0] !== rawName[0].toLowerCase();
    return capitalized ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  });
}

/** "25 sept 2026" para listas y vistas previas. */
export function formatScheduleDate(date: string) {
  const { year, month, day } = parts(date);
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Descripción llana de la periodicidad ("Cada mes, el día 1"; "Cada 2 meses, el último día"). */
export function describeSchedule(schedule: Pick<RecurringSchedule, "dayOfMonth" | "intervalMonths">) {
  const every = schedule.intervalMonths === 1
    ? "Cada mes"
    : schedule.intervalMonths === 3
      ? "Cada trimestre"
      : schedule.intervalMonths === 12
        ? "Cada año"
        : `Cada ${schedule.intervalMonths} meses`;
  const day = schedule.dayOfMonth >= 31 ? "el último día del mes" : `el día ${schedule.dayOfMonth}`;
  return `${every}, ${day}`;
}
