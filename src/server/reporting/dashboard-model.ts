/**
 * Pure helpers of the financial dashboard: period ranges, mapping of SQL aggregate rows
 * into fixed shapes (aging buckets, 12-month series) and fiscal deadlines. No database
 * access here so everything is unit-testable; the queries live in `dashboard.ts`.
 */
import { getDaysUntilDue, getSpanishFiscalDueDate, spanishFiscalModels, type SpanishFiscalModelCode } from "@/lib/fiscal-spain";

export type FinancePeriod = "month" | "quarter" | "year";

export const financePeriodOptions: Array<{ value: FinancePeriod; label: string; previousLabel: string }> = [
  { value: "month", label: "Este mes", previousLabel: "mismo tramo del mes anterior" },
  { value: "quarter", label: "Trimestre", previousLabel: "mismo tramo del trimestre anterior" },
  { value: "year", label: "Año", previousLabel: "mismo tramo del año anterior" },
];

export function parseFinancePeriod(value: string | string[] | undefined | null): FinancePeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "quarter" || raw === "year" ? raw : "month";
}

export type DateRange = { start: Date; end: Date };

function periodStart(period: FinancePeriod, year: number, month: number) {
  if (period === "month") return new Date(Date.UTC(year, month, 1));
  if (period === "quarter") return new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1));
  return new Date(Date.UTC(year, 0, 1));
}

function shiftPeriod(date: Date, period: FinancePeriod, steps: number) {
  const months = period === "month" ? 1 : period === "quarter" ? 3 : 12;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months * steps, 1));
}

/**
 * Current calendar period to date, and the same elapsed stretch of the previous period
 * (1–24 Sep vs 1–24 Aug), so "vs periodo anterior" is fair at any day of the month.
 * `current.end` / `previous.end` are exclusive.
 */
export function financePeriodRanges(period: FinancePeriod, now = new Date()): { current: DateRange; previous: DateRange; full: DateRange } {
  const start = periodStart(period, now.getUTCFullYear(), now.getUTCMonth());
  const fullEnd = shiftPeriod(start, period, 1);
  const previousStart = shiftPeriod(start, period, -1);
  // Whole days: today counts entirely (documents are dated at midnight).
  const todayEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const currentEnd = Math.min(todayEnd, fullEnd.getTime());
  const previousEnd = new Date(Math.min(previousStart.getTime() + (currentEnd - start.getTime()), start.getTime()));
  return {
    current: { start, end: new Date(currentEnd) },
    previous: { start: previousStart, end: previousEnd },
    full: { start, end: fullEnd },
  };
}

/** Calendar quarter containing `now` (VAT is filed per quarter whatever the selected period). */
export function currentQuarter(now = new Date()) {
  const start = periodStart("quarter", now.getUTCFullYear(), now.getUTCMonth());
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  return { start, end: shiftPeriod(start, "quarter", 1), label: `${quarter}T ${now.getUTCFullYear()}` };
}

/** Percentage change, or null when there is no base to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function toAmount(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export const agingBuckets = [
  { key: "current", label: "Sin vencer" },
  { key: "d0_30", label: "0–30 días" },
  { key: "d31_60", label: "31–60 días" },
  { key: "d61_90", label: "61–90 días" },
  { key: "d90_plus", label: "Más de 90 días" },
] as const;

export type AgingBucketKey = (typeof agingBuckets)[number]["key"];
export type AgingBucket = { key: AgingBucketKey; label: string; amount: number; count: number };

/** Bucket of a receivable/payable by days past its due date (no due date = not overdue). */
export function agingBucketFor(daysOverdue: number | null): AgingBucketKey {
  if (daysOverdue === null || daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d0_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

/** Grouped SQL rows → every bucket in a fixed order (missing buckets as zero) plus totals. */
export function mapAgingRows(rows: Array<{ bucket: string; amount: string | number | null; count: string | number | null }>) {
  const byKey = new Map(rows.map((row) => [row.bucket, row]));
  const buckets: AgingBucket[] = agingBuckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    amount: toAmount(byKey.get(bucket.key)?.amount),
    count: Number(byKey.get(bucket.key)?.count ?? 0),
  }));
  const total = Math.round(buckets.reduce((sum, bucket) => sum + bucket.amount * 100, 0)) / 100;
  const overdue = Math.round(buckets.filter((bucket) => bucket.key !== "current").reduce((sum, bucket) => sum + bucket.amount * 100, 0)) / 100;
  return { buckets, total, overdue, count: buckets.reduce((sum, bucket) => sum + bucket.count, 0) };
}

export type MonthKey = { key: string; label: string; longLabel: string; start: Date };

const shortMonth = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" });
const longMonth = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });

/** The last `count` calendar months ending with the current one (UTC), oldest first. */
export function lastMonths(now = new Date(), count = 12): MonthKey[] {
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - index), 1));
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = `${shortMonth.format(start).replace(".", "")} ${String(start.getUTCFullYear()).slice(2)}`;
    return { key, label, longLabel: longMonth.format(start), start };
  });
}

/** Rows grouped by `YYYY-MM` → one value per month (zero when a month has no rows). */
export function fillMonthlySeries(months: MonthKey[], rows: Array<{ month: string; value: string | number | null }>) {
  const byMonth = new Map<string, number>();
  for (const row of rows) byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + toAmount(row.value));
  return months.map((month) => toAmount(byMonth.get(month.key) ?? 0));
}

/** Running balance: opening balance plus each month's net movement. */
export function cumulativeSeries(opening: number, deltas: number[]) {
  let balance = Math.round(opening * 100);
  return deltas.map((delta) => {
    balance += Math.round(delta * 100);
    return balance / 100;
  });
}

export type FiscalDeadline = {
  code: SpanishFiscalModelCode;
  name: string;
  period: string;
  periodLabel: string;
  dueDate: Date;
  daysUntil: number;
  status: "overdue" | "due-soon" | "upcoming";
};

/**
 * VAT and annual summaries a Spanish SME always files (303 quarterly, 390 and 347 yearly)
 * for the periods already closed, due within `horizonDays`. Overdue ones are only listed when
 * a draft/ready report exists (the company started that period in the app) and is not filed,
 * so a brand-new company is not told it missed deadlines from before it existed.
 */
export function upcomingFiscalDeadlines(input: {
  now?: Date;
  reports: Array<{ code: string; period: string; status: string }>;
  horizonDays?: number;
}): FiscalDeadline[] {
  const now = input.now ?? new Date();
  const horizon = input.horizonDays ?? 30;
  const year = now.getUTCFullYear();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const previousQuarters = [1, 2].map((back) => {
    const index = year * 4 + (quarter - 1) - back;
    return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
  });
  const candidates: Array<{ code: SpanishFiscalModelCode; period: string }> = [
    ...previousQuarters.map((period) => ({ code: "303" as const, period })),
    { code: "390", period: String(year - 1) },
    { code: "347", period: String(year - 1) },
  ];
  const reportByKey = new Map(input.reports.map((report) => [`${report.code}:${report.period}`, report]));

  return candidates
    .flatMap((candidate) => {
      const dueDate = getSpanishFiscalDueDate(candidate.period, candidate.code);
      if (!dueDate) return [];
      const report = reportByKey.get(`${candidate.code}:${candidate.period}`);
      if (report?.status === "FILED") return [];
      const daysUntil = getDaysUntilDue(dueDate, now);
      if (daysUntil > horizon) return [];
      if (daysUntil < 0 && !report) return [];
      const model = spanishFiscalModels.find((entry) => entry.code === candidate.code);
      const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(candidate.period);
      return [{
        code: candidate.code,
        name: model?.shortName ?? `Modelo ${candidate.code}`,
        period: candidate.period,
        periodLabel: quarterMatch ? `${quarterMatch[2]}T ${quarterMatch[1]}` : `Ejercicio ${candidate.period}`,
        dueDate,
        daysUntil,
        status: daysUntil < 0 ? "overdue" : daysUntil <= 7 ? "due-soon" : "upcoming",
      } satisfies FiscalDeadline];
    })
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime());
}

/** Whole days an open document is past due (0 when not due yet or without due date). */
export function daysPastDue(dueDate: Date | string | null, now = new Date()) {
  if (!dueDate) return 0;
  return Math.max(0, -getDaysUntilDue(dueDate instanceof Date ? dueDate : new Date(dueDate), now));
}
