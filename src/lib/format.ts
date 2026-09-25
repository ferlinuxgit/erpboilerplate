export function formatMoney(value: string | number, currencyCode = "EUR", locale = "es-ES") {
  const amount = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(amount);
}

export function formatAmount(value: string | number, locale = "es-ES") {
  const amount = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatPercent(value: string | number, locale = "es-ES") {
  const rate = typeof value === "number" ? value : Number(value);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number.isFinite(rate) ? rate : 0)} %`;
}

export function formatDate(value: Date | string, locale = "es-ES") {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function formatDateTime(value: Date | string, locale = "es-ES") {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Parses numbers typed by Spanish users. Accepts "1.234,56", "1234,56",
 * "1234.56", "1,234.56", "12 %" or "1.234,56 €". Returns null for empty or
 * unparseable input so callers can distinguish "no value" from zero.
 */
export function parseDecimalInput(
  value: string | number | null | undefined,
  { maximumFractionDigits }: { maximumFractionDigits?: number } = {},
): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  let text = String(value).replace(/[\s  €%]/g, "").replace(/^\+/, "");
  if (!text || text === "-") return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // The right-most separator is the decimal mark; the other one groups.
    text = lastComma > lastDot ? text.replaceAll(".", "").replace(",", ".") : text.replaceAll(",", "");
  } else if (lastComma >= 0) {
    text = (text.match(/,/g)?.length ?? 0) > 1 ? text.replaceAll(",", "") : text.replace(",", ".");
  } else if (lastDot >= 0 && (text.match(/\./g)?.length ?? 0) > 1) {
    // "1.234.567" can only be thousands grouping.
    text = text.replaceAll(".", "");
  } else if (lastDot >= 0 && maximumFractionDigits !== undefined && maximumFractionDigits < 3 && /^-?[1-9]\d{0,2}\.\d{3}$/.test(text)) {
    // A single dot is a decimal mark ("2.125" from the database), except for
    // money-like fields where three decimals are impossible: "1.500" = 1500.
    text = text.replace(".", "");
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Formats a number for an editable field (es-ES, without currency symbol). */
export function formatDecimalInput(
  value: number | null | undefined,
  { minimumFractionDigits = 0, maximumFractionDigits = 2 }: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits, maximumFractionDigits }).format(value);
}

export type BalanceSide = "Deudor" | "Acreedor" | "Saldado";

/** Lado del saldo contable (debe − haber): deudor si es positivo, acreedor si es negativo. */
export function balanceSide(balance: string | number): BalanceSide {
  const amount = typeof balance === "number" ? balance : Number(balance);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return "Saldado";
  return amount > 0 ? "Deudor" : "Acreedor";
}

/** "1.234,00 € deudor" / "56,00 € acreedor" / "0,00 €": saldo sin signo con su lado en palabras. */
export function formatBalance(balance: string | number, currencyCode = "EUR") {
  const amount = typeof balance === "number" ? balance : Number(balance);
  const side = balanceSide(amount);
  const money = formatMoney(Math.abs(Number.isFinite(amount) ? amount : 0), currencyCode);
  return side === "Saldado" ? money : `${money} ${side.toLowerCase()}`;
}

/** Importe tal como lo piden los formularios de la sede de la AEAT: sin miles y con coma decimal ("1234,56"). */
export function formatAeatAmount(value: string | number) {
  const amount = typeof value === "number" ? value : Number(value);
  return (Number.isFinite(amount) ? amount : 0).toFixed(2).replace(".", ",");
}
