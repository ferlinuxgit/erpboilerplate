/**
 * Plazos del Impuesto sobre Sociedades y de las obligaciones mercantiles anuales de una sociedad,
 * a partir de la fecha de cierre del ejercicio (funciones puras, fechas en UTC a medianoche).
 *
 * - Modelo 200: los 25 días naturales siguientes a los 6 meses posteriores al cierre (art. 124.1
 *   de la Ley 27/2014, contrastado con el BOE el 27-11-2026). Ejercicio natural: 1 a 25 de julio.
 * - Modelo 202: primeros 20 días naturales de abril, octubre y diciembre (art. 40.1, contrastado).
 * - Modelo 232 (operaciones vinculadas y paraísos fiscales): mes siguiente a los diez meses
 *   posteriores al cierre (Orden HFP/816/2017). Ejercicio natural: noviembre. No contrastado ese día.
 * - Legalización de libros: cuatro meses desde el cierre (art. 18.1 de la Ley 14/2013). Ejercicio
 *   natural: 30 de abril. No contrastado ese día.
 * - Depósito de cuentas anuales: un mes desde su aprobación (art. 279 de la Ley de Sociedades de
 *   Capital); la junta las aprueba en los seis meses siguientes al cierre (art. 164). Ejercicio
 *   natural: como tarde el 30 de julio. No contrastado ese día.
 *
 * Los fines de semana y festivos no se trasladan aquí: lo hace quien muestra la fecha.
 */

function utcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return utcDate(year, monthIndex + 1, 0).getUTCDate();
}

/** Suma meses de fecha a fecha; si el mes de destino no tiene ese día, el último del mes. */
export function addMonthsUtc(date: Date, months: number, options: { keepMonthEnd?: boolean } = {}) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const last = lastDayOfMonth(targetYear, targetMonth);
  const isMonthEnd = date.getUTCDate() === lastDayOfMonth(year, date.getUTCMonth());
  const day = options.keepMonthEnd && isMonthEnd ? last : Math.min(date.getUTCDate(), last);
  return utcDate(targetYear, targetMonth, day);
}

function addDaysUtc(date: Date, days: number) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}

/** Día civil (UTC) de un instante guardado como fecha de fin de ejercicio. */
export function civilDay(date: Date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Plazo del modelo 200. Un cierre a fin de mes lleva el semestre hasta el fin del mes de destino
 * (cierre el 30 de junio: del 1 al 25 de enero), que es como lo publica la AEAT para el ejercicio
 * natural; para otros cierres es la interpretación habitual, no contrastada con un ejemplo oficial.
 */
export function corporateTaxReturnWindow(yearEnd: Date) {
  const sixMonthsLater = addMonthsUtc(civilDay(yearEnd), 6, { keepMonthEnd: true });
  return { from: addDaysUtc(sixMonthsLater, 1), to: addDaysUtc(sixMonthsLater, 25) };
}

/** Último día del plazo del pago fraccionado: el 20 de abril, octubre o diciembre. */
export function installmentDueDate(year: number, dueMonth: number) {
  return utcDate(year, dueMonth - 1, 20);
}

export type CorporateReminderCode = "232" | "LIBROS" | "CCAA";

export type CorporateReminder = {
  code: CorporateReminderCode;
  name: string;
  dueDate: Date;
  reason: string;
};

export type CorporateReminderSettings = {
  /** Modelo 232: solo si el usuario lo activa (depende de operaciones vinculadas que el programa no detecta). */
  relatedParties: boolean;
  /** Legalización de libros en el Registro Mercantil. */
  books: boolean;
  /** Depósito de las cuentas anuales en el Registro Mercantil. */
  annualAccounts: boolean;
};

export const DEFAULT_REMINDER_SETTINGS: CorporateReminderSettings = { relatedParties: false, books: true, annualAccounts: true };

/** Recordatorios informativos (sin cálculo) del ejercicio que cerró en `yearEnd`. */
export function corporateReminders(yearEnd: Date, yearCode: string, settings: CorporateReminderSettings): CorporateReminder[] {
  const close = civilDay(yearEnd);
  const reminders: CorporateReminder[] = [];
  if (settings.books) {
    reminders.push({
      code: "LIBROS",
      name: "Legalización de libros",
      dueDate: addMonthsUtc(close, 4),
      reason: `Libros del ejercicio ${yearCode} (diario, inventarios y cuentas anuales, actas…): se legalizan por vía telemática en el Registro Mercantil en los cuatro meses siguientes al cierre.`,
    });
  }
  if (settings.annualAccounts) {
    reminders.push({
      code: "CCAA",
      name: "Depósito de cuentas anuales",
      dueDate: addMonthsUtc(addMonthsUtc(close, 6), 1),
      reason: `Cuentas anuales de ${yearCode}: se depositan en el Registro Mercantil en el mes siguiente a su aprobación por la junta, que tiene seis meses desde el cierre. Esta es la fecha más tardía.`,
    });
  }
  if (settings.relatedParties) {
    const tenMonthsLater = addMonthsUtc(close, 10, { keepMonthEnd: true });
    const dueMonthStart = utcDate(tenMonthsLater.getUTCFullYear(), tenMonthsLater.getUTCMonth() + 1, 1);
    reminders.push({
      code: "232",
      name: "Modelo 232",
      dueDate: utcDate(dueMonthStart.getUTCFullYear(), dueMonthStart.getUTCMonth() + 1, 0),
      reason: `Declaración informativa de operaciones vinculadas y con paraísos fiscales de ${yearCode}. Solo si la sociedad supera los importes que obligan a presentarla; el programa no la calcula.`,
    });
  }
  return reminders;
}

/** Días naturales del periodo impositivo (ambos extremos incluidos). */
export function periodDays(startsAt: Date, endsAt: Date) {
  return Math.round((civilDay(endsAt).getTime() - civilDay(startsAt).getTime()) / 86_400_000) + 1;
}
