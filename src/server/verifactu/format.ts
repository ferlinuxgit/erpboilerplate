/** Formatos exigidos por la AEAT en los registros VeriFactu (fechas, importes, NIF). */

export const VERIFACTU_TIMEZONE = "Europe/Madrid";

function partsInZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const pad = (value: number, length = 2) => String(Math.abs(value)).padStart(length, "0");

/** Fecha de expedición dd-mm-aaaa (en la zona horaria de la empresa, España peninsular por defecto). */
export function formatAeatDate(date: Date, timeZone = VERIFACTU_TIMEZONE) {
  const parts = partsInZone(date, timeZone);
  return `${pad(parts.day)}-${pad(parts.month)}-${pad(parts.year, 4)}`;
}

/**
 * FechaHoraHusoGenRegistro: ISO 8601 con segundos y huso horario, p. ej. 2024-01-01T19:20:30+01:00.
 * Se guarda el texto exacto en el registro porque forma parte de la huella.
 */
export function formatAeatDateTime(date: Date, timeZone = VERIFACTU_TIMEZONE) {
  const parts = partsInZone(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMinutes = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
}

/** Importe con punto decimal y 2 decimales ("123.45", "-12.30"): el mismo texto en XML, huella y QR. */
export function formatAeatAmount(value: number) {
  const cents = Math.round(value * 100);
  const normalized = Object.is(cents, -0) ? 0 : cents;
  return (normalized / 100).toFixed(2);
}

/** Importe del QR: punto decimal; se usa el mismo texto que ImporteTotal para que el cotejo coincida. */
export const formatQrAmount = formatAeatAmount;

/** NIF español del emisor (9 caracteres) sin prefijo de país, espacios ni guiones. */
export function normalizeIssuerNif(value: string | null | undefined) {
  const normalized = (value ?? "").toUpperCase().replace(/[\s.-]/g, "");
  return normalized.startsWith("ES") && normalized.length === 11 ? normalized.slice(2) : normalized;
}

export function isValidIssuerNifFormat(value: string | null | undefined) {
  return /^[0-9A-Z][0-9]{7}[0-9A-Z]$/.test(normalizeIssuerNif(value));
}
