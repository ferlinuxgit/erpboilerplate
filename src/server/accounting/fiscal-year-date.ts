import { eq, sql, type SQL } from "drizzle-orm";

import { company, journalEntry } from "@/db/schema";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import type { DbClient } from "@/lib/db";
import { fiscalCivilDate, localMidnightInstant } from "@/lib/fiscal-spain";

/**
 * EJERCICIO CONTABLE EN HORA LOCAL
 *
 * Las fechas se guardan de dos formas (ver «HORA LOCAL DE LOS PERIODOS FISCALES» en
 * `@/lib/fiscal-spain`): como fecha civil (lo elegido en un formulario: las 00:00:00 UTC exactas de
 * ese día) o como instante real (tickets del TPV, rectificativas, que usan «ahora»). Y los
 * ejercicios se guardan como fechas civiles (`startsAt` y `endsAt` a las 00:00 UTC).
 *
 * Regla única: una fecha pertenece al ejercicio de su DÍA CIVIL en la zona horaria de la empresa.
 * Un ticket del 1 de enero a las 00:30 de Madrid (31-12 23:30 UTC) es del ejercicio nuevo, con su
 * serie y su numeración de asientos; una fecha de formulario no se mueve nunca.
 *
 * En zonas al oeste de UTC (América) la medianoche local es posterior a las 00:00 UTC, y aplicarla
 * sacaría de su día a las fechas de formulario. Por eso el límite es siempre el más temprano de los
 * dos (medianoche local o medianoche UTC): en España es la medianoche local; al oeste de UTC se
 * conserva el comportamiento anterior.
 */

const DAY_MS = 86_400_000;

function isCivilDate(date: Date) {
  return date.getTime() % DAY_MS === 0;
}

/**
 * Día contable de una fecha, expresado como fecha civil (00:00 UTC de ese día). Es el valor que se
 * compara con `fiscal_year.startsAt` y `endsAt`.
 */
export function accountingDay(date: Date, timeZone: string): Date {
  if (isCivilDate(date)) return date;
  const utcDay = Math.floor(date.getTime() / DAY_MS) * DAY_MS;
  const local = fiscalCivilDate(date, timeZone);
  return new Date(Math.max(utcDay, Date.UTC(local.year, local.month - 1, local.day)));
}

/** Instante en que empieza el día civil indicado (00:00 UTC) para el ejercicio contable. */
export function accountingDayStartInstant(civilDay: Date, timeZone: string): Date {
  if (!isCivilDate(civilDay)) return civilDay;
  const local = localMidnightInstant(civilDay.getUTCFullYear(), civilDay.getUTCMonth(), civilDay.getUTCDate(), timeZone);
  return local.getTime() < civilDay.getTime() ? local : civilDay;
}

/** Día siguiente al último del ejercicio, como fecha civil (00:00 UTC). */
function dayAfter(endsAt: Date) {
  return new Date(Date.UTC(endsAt.getUTCFullYear(), endsAt.getUTCMonth(), endsAt.getUTCDate() + 1));
}

export type AccountingRange = {
  /** Límites como fechas civiles (00:00 UTC): así se fechan los asientos de apertura, regularización y cierre. */
  civil: { from: Date | null; toExclusive: Date };
  /** Los mismos límites como instantes reales (medianoche local): el resto de asientos. */
  instants: { from: Date | null; toExclusive: Date };
};

/** Rango [desde, hasta) de fechas civiles convertido a los instantes del ejercicio contable. */
export function accountingRange(range: { from?: Date | null; toExclusive: Date }, timeZone: string): AccountingRange {
  return {
    civil: { from: range.from ?? null, toExclusive: range.toExclusive },
    instants: {
      from: range.from ? accountingDayStartInstant(range.from, timeZone) : null,
      toExclusive: accountingDayStartInstant(range.toExclusive, timeZone),
    },
  };
}

/** Rango completo de un ejercicio (`endsAt` es su último día, incluido). */
export function fiscalYearAccountingRange(year: { startsAt: Date; endsAt: Date }, timeZone: string): AccountingRange {
  return accountingRange({ from: year.startsAt, toExclusive: dayAfter(year.endsAt) }, timeZone);
}

/**
 * Fechas de los asientos de regularización y de cierre: los dos últimos segundos del último día del
 * ejercicio EN HORA LOCAL (antes eran los dos últimos segundos UTC, que en Madrid ya son del día 1).
 */
export function fiscalYearClosingInstants(year: { endsAt: Date }, timeZone: string) {
  const end = accountingDayStartInstant(dayAfter(year.endsAt), timeZone).getTime();
  return { regularization: new Date(end - 2_000), closing: new Date(end - 1_000) };
}

/** Asientos del ciclo del ejercicio (mismos valores que `FISCAL_YEAR_SOURCE`). */
const LIFECYCLE_SOURCES = ["fiscalYearRegularization", "fiscalYearClosing", "fiscalYearOpening"] as const;

export function isLifecycleEntrySql(): SQL {
  return sql`coalesce(${journalEntry.sourceType}, '') in (${sql.join(LIFECYCLE_SOURCES.map((value) => sql`${value}`), sql`, `)})`;
}

/**
 * Condición SQL «el asiento es anterior al límite». Los asientos del ciclo (apertura,
 * regularización, cierre y sus anulaciones) se comparan con el límite civil: los generados antes de
 * este cambio están fechados a las 23:59:58 UTC del último día (ya día 1 en Madrid) y deben seguir
 * contando en su ejercicio. El resto se compara con la medianoche local.
 */
export function postedBeforeSql(range: AccountingRange, bound: "from" | "toExclusive"): SQL {
  const civil = range.civil[bound];
  const instant = range.instants[bound];
  if (!civil || !instant) return sql`false`;
  if (civil.getTime() === instant.getTime()) return sql`${journalEntry.postedAt} < ${civil}`;
  return sql`(case when ${isLifecycleEntrySql()} then ${journalEntry.postedAt} < ${civil} else ${journalEntry.postedAt} < ${instant} end)`;
}

/** Condición SQL «el asiento cae dentro del rango» con la misma regla que `postedBeforeSql`. */
export function postedInRangeSql(range: AccountingRange): SQL {
  const before = postedBeforeSql(range, "toExclusive");
  return range.civil.from ? sql`(not ${postedBeforeSql(range, "from")} and ${before})` : before;
}

/**
 * Filtro «del día X al día Y» de un listado (fechas civiles, las dos opcionales, `toExclusive` es el
 * día siguiente al último) con los mismos límites que el ejercicio: así el diario, el mayor y los
 * estados enseñan un asiento en el mismo periodo en el que está numerado. Sin fechas no filtra.
 */
export function postedBetweenSql(range: { from?: Date | null; toExclusive?: Date | null }, timeZone: string): SQL | undefined {
  const from = range.from ?? null;
  const toExclusive = range.toExclusive ?? null;
  if (toExclusive) return postedInRangeSql(accountingRange({ from, toExclusive }, timeZone));
  if (from) return sql`(not ${postedBeforeSql(accountingRange({ from, toExclusive: from }, timeZone), "from")})`;
  return undefined;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha civil (00:00 UTC) de una clave `AAAA-MM-DD`; null si no es una fecha válida. */
export function civilDateFromKey(key: string | null | undefined): Date | null {
  if (!key || !DATE_KEY.test(key)) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Igual que `postedBetweenSql` con los días tal como llegan de un filtro (`AAAA-MM-DD`, ambos incluidos). */
export function postedBetweenKeysSql(from: string | null | undefined, to: string | null | undefined, timeZone: string): SQL | undefined {
  const last = civilDateFromKey(to);
  return postedBetweenSql({ from: civilDateFromKey(from), toExclusive: last ? new Date(last.getTime() + DAY_MS) : null }, timeZone);
}

/** Zona horaria de una empresa según su país y territorio (Canarias: Atlantic/Canary). */
export function companyTimeZoneOf(row: { countryCode?: string | null; postalCode?: string | null; province?: string | null } | null | undefined) {
  return getCountryFiscalProfile(taxTerritoryOf(row) ?? row?.countryCode ?? "ES").timezone;
}

export async function loadCompanyTimeZone(client: DbClient, companyId: string) {
  const rows = await client
    .select({ countryCode: company.countryCode, postalCode: company.postalCode, province: company.province })
    .from(company)
    .where(eq(company.id, companyId));
  return companyTimeZoneOf(rows[0]);
}

/** Ninguna zona horaria va más allá de UTC+14: si ni así cambia el día, no hace falta saber la zona. */
const MAX_OFFSET_MS = 14 * 3_600_000;

/**
 * Día contable de una fecha para una empresa. Solo consulta la empresa cuando la zona horaria puede
 * cambiar el resultado (instantes de las últimas horas del día UTC).
 */
export async function resolveAccountingDay(client: DbClient, companyId: string, date: Date): Promise<Date> {
  if (Number.isNaN(date.getTime()) || isCivilDate(date)) return date;
  const utcDay = Math.floor(date.getTime() / DAY_MS) * DAY_MS;
  if (Math.floor((date.getTime() + MAX_OFFSET_MS) / DAY_MS) * DAY_MS === utcDay) return new Date(utcDay);
  return accountingDay(date, await loadCompanyTimeZone(client, companyId));
}
