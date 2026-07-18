export type ReportingPeriod = "month" | "quarter" | "year";

export function getReportingPeriodRanges(period: ReportingPeriod, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = period === "month"
    ? new Date(Date.UTC(year, month, 1))
    : period === "quarter"
      ? new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1))
      : new Date(Date.UTC(year, 0, 1));
  const end = period === "month"
    ? new Date(Date.UTC(year, month + 1, 1))
    : period === "quarter"
      ? new Date(Date.UTC(year, Math.floor(month / 3) * 3 + 3, 1))
      : new Date(Date.UTC(year + 1, 0, 1));
  const duration = end.getTime() - start.getTime();
  return { current: { start, end }, previous: { start: new Date(start.getTime() - duration), end: start } };
}
