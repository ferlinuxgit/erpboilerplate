/** Periodos del resumen de impuestos (código puro, sin base de datos). */

export type TaxSummaryPeriodicity = "monthly" | "quarterly";

export type TaxSummaryPeriod = {
  key: string;
  label: string;
  start: Date;
  endExclusive: Date;
};

const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-Q3" (trimestre) o "2026-07" (mes) → rango UTC [inicio, fin). */
export function parseTaxSummaryPeriod(key: string | null | undefined): TaxSummaryPeriod | null {
  const value = (key ?? "").trim().toUpperCase();
  const quarter = /^(20\d{2})-Q([1-4])$/.exec(value);
  if (quarter) {
    const year = Number(quarter[1]);
    const index = Number(quarter[2]);
    return { key: value, label: `${index}.º trimestre ${year}`, start: new Date(Date.UTC(year, (index - 1) * 3, 1)), endExclusive: new Date(Date.UTC(year, index * 3, 1)) };
  }
  const month = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(value);
  if (month) {
    const year = Number(month[1]);
    const index = Number(month[2]) - 1;
    return { key: value, label: `${monthNames[index]} ${year}`, start: new Date(Date.UTC(year, index, 1)), endExclusive: new Date(Date.UTC(year, index + 1, 1)) };
  }
  return null;
}

export function taxSummaryPeriodKey(date: Date, periodicity: TaxSummaryPeriodicity) {
  const year = date.getUTCFullYear();
  if (periodicity === "monthly") return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Periodos para elegir: del actual hacia atrás (`count` periodos). */
export function recentTaxSummaryPeriods(now: Date, periodicity: TaxSummaryPeriodicity, count = 8): TaxSummaryPeriod[] {
  const periods: TaxSummaryPeriod[] = [];
  const step = periodicity === "monthly" ? 1 : 3;
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let index = 0; index < count; index += 1) {
    const period = parseTaxSummaryPeriod(taxSummaryPeriodKey(cursor, periodicity));
    if (period) periods.push(period);
    cursor.setUTCMonth(cursor.getUTCMonth() - step);
  }
  return periods;
}
