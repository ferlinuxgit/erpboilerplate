const defaultNumberWidth = 6;

export const defaultSeriesFormat = "{PREFIX}{NUMBER:6}";

export function formatSeriesNumber(input: {
  format?: string | null;
  nextNumber: number;
  prefix?: string | null;
  referenceDate?: Date | string | null;
}) {
  const date = input.referenceDate ? new Date(input.referenceDate) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = String(safeDate.getUTCFullYear());
  const sequence = Math.max(1, Math.trunc(input.nextNumber));
  const prefix = input.prefix ?? "";
  const format = input.format?.trim() || defaultSeriesFormat;

  return format.replaceAll(/\{(PREFIX|YYYY|YEAR|YY|NUMBER(?::(\d{1,2}))?)\}/g, (token, key: string, width?: string) => {
    if (key === "PREFIX") return prefix;
    if (key === "YYYY" || key === "YEAR") return year;
    if (key === "YY") return year.slice(-2);
    if (key.startsWith("NUMBER")) return String(sequence).padStart(width ? Number(width) : defaultNumberWidth, "0");
    return token;
  });
}

export function previewSeriesFormat(format: string, prefix: string, nextNumber: number, referenceDate: Date | string = new Date()) {
  return formatSeriesNumber({ format, prefix, nextNumber, referenceDate });
}
