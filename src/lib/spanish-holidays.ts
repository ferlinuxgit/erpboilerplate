/**
 * Festivos de ámbito nacional en España, para el cómputo de plazos (SII y modelos tributarios).
 * Módulo puro y compartido: no depende de la base de datos ni del servidor.
 *
 * NORMA. El art. 37.2 del Estatuto de los Trabajadores y el art. 45 del Real Decreto 2001/1983
 * distinguen tres clases de fiesta, que la Dirección General de Trabajo publica cada año en el BOE
 * con esta leyenda:
 *   (*)   Fiesta Nacional no sustituible.
 *   (**)  Fiesta Nacional respecto de la que no se ha ejercido la facultad de sustitución.
 *   (***) Fiesta de Comunidad Autónoma.
 *
 * LISTA QUE SE APLICA
 * 1. Las (*) NO SUSTITUIBLES, festivas en todas las comunidades y en Ceuta y Melilla:
 *    1 de enero, Viernes Santo, 1 de mayo, 15 de agosto, 12 de octubre, 1 de noviembre,
 *    6 de diciembre, 8 de diciembre y 25 de diciembre. Se aplican a cualquier año.
 * 2. El 6 de ENERO (Epifanía) es sustituible (**): solo cuenta en los años en que se ha contrastado
 *    que ninguna comunidad lo ha sustituido (`CONTRASTED_YEARS`). En 2026 y 2027 es festivo en las
 *    diecinueve.
 * 3. El JUEVES SANTO NO se incluye: es sustituible y hay comunidades que no lo guardan (Cataluña y
 *    La Rioja en 2026; Cataluña y la Comunitat Valenciana en 2027). Tampoco San José ni Santiago.
 *
 * TRASLADO AL LUNES. Cuando una fiesta nacional cae en domingo, el descanso del lunes siguiente lo
 * decide cada comunidad (art. 45.3 del RD 2001/1983), así que NO es de ámbito nacional y NO se
 * aplica aquí. Contrastado: en 2026 el 1 de noviembre y el 6 de diciembre caen en domingo y los
 * lunes 2 de noviembre y 7 de diciembre solo son festivos en nueve comunidades cada uno; en 2027 el
 * 15 de agosto cae en domingo y el lunes 16 solo lo es en seis. La fiesta en domingo ya es inhábil
 * por ser domingo, de modo que no hace falta nada más.
 *
 * FUENTES CONTRASTADAS (anexos de las resoluciones de la Dirección General de Trabajo):
 * - 2026: Resolución de 17 de octubre de 2025 (BOE de 28 de octubre de 2025, BOE-A-2025-21667).
 * - 2027: Resolución de 8 de octubre de 2026 (BOE de 13 de octubre de 2026, BOE-A-2026-21254).
 * Para el resto de años solo se aplican las no sustituibles (apartado 1), que fija la norma y no la
 * resolución anual; de faltar un festivo, el plazo calculado queda como mucho un día antes del
 * real, nunca después.
 *
 * NO SE CONTEMPLAN los festivos autonómicos ni los locales: dependen del domicilio de cada empresa.
 */

export type SpanishHoliday = {
  /** Fecha civil AAAA-MM-DD. */
  date: string;
  name: string;
  /** `fixed`: no sustituible (*); `substitutable`: sustituible (**) y guardada en toda España ese año. */
  kind: "fixed" | "substitutable";
};

const pad = (value: number) => String(value).padStart(2, "0");
const key = (year: number, month: number, day: number) => `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;

/** Domingo de Pascua (algoritmo gregoriano anónimo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): { year: number; month: number; day: number } {
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

/** Fiestas nacionales no sustituibles de fecha fija (mes, día, nombre). */
const FIXED_HOLIDAYS: ReadonlyArray<readonly [number, number, string]> = [
  [1, 1, "Año Nuevo"],
  [5, 1, "Fiesta del Trabajo"],
  [8, 15, "Asunción de la Virgen"],
  [10, 12, "Fiesta Nacional de España"],
  [11, 1, "Todos los Santos"],
  [12, 6, "Día de la Constitución Española"],
  [12, 8, "Inmaculada Concepción"],
  [12, 25, "Natividad del Señor"],
];

/** Años cuyo anexo del BOE se ha contrastado: en ellos el 6 de enero es festivo en toda España. */
export const CONTRASTED_YEARS: ReadonlySet<number> = new Set([2026, 2027]);

const cache = new Map<number, SpanishHoliday[]>();

/** Festivos de ámbito nacional de un año, ordenados por fecha. */
export function spanishNationalHolidays(year: number): SpanishHoliday[] {
  const cached = cache.get(year);
  if (cached) return cached;
  const holidays: SpanishHoliday[] = FIXED_HOLIDAYS.map(([month, day, name]) => ({ date: key(year, month, day), name, kind: "fixed" as const }));
  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day - 2));
  holidays.push({ date: key(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()), name: "Viernes Santo", kind: "fixed" });
  if (CONTRASTED_YEARS.has(year)) holidays.push({ date: key(year, 1, 6), name: "Epifanía del Señor", kind: "substitutable" });
  holidays.sort((left, right) => left.date.localeCompare(right.date));
  cache.set(year, holidays);
  return holidays;
}

const keyCache = new Map<number, Set<string>>();

/** Claves AAAA-MM-DD de los festivos nacionales de un año. */
export function spanishNationalHolidayKeys(year: number): Set<string> {
  let keys = keyCache.get(year);
  if (!keys) {
    keys = new Set(spanishNationalHolidays(year).map((holiday) => holiday.date));
    keyCache.set(year, keys);
  }
  return keys;
}

/** ¿Es festivo nacional esa fecha civil? (mes de 1 a 12). */
export function isSpanishNationalHoliday(year: number, month: number, day: number) {
  return spanishNationalHolidayKeys(year).has(key(year, month, day));
}

/** Sábado, domingo o festivo nacional. Los festivos autonómicos y locales no se contemplan. */
export function isSpanishNonBusinessDay(year: number, month: number, day: number) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6 || isSpanishNationalHoliday(year, month, day);
}
