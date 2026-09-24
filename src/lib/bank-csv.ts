export type BankCsvRow = {
  postedAt: Date;
  amount: number;
  description: string;
};

function unquote(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("\"") && trimmed.endsWith("\"") ? trimmed.slice(1, -1).replace(/""/g, "\"").trim() : trimmed;
}

/** Fechas ISO (2026-07-18) o españolas (18/07/2026, 18-07-2026) → medianoche UTC. */
export function parseBankDate(raw: string): Date | null {
  const value = unquote(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const spanish = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : spanish
      ? [Number(spanish[3]), Number(spanish[2]), Number(spanish[1])]
      : [NaN, NaN, NaN];
  if (!Number.isFinite(year)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * Importes con coma decimal (1250,50), con separador de miles español (1.250,50) o
 * anglosajón (1,250.50). Un único punto se interpreta como decimal (-80.25).
 */
export function parseBankAmount(raw: string): number | null {
  let value = unquote(raw).replace(/\s|€|EUR/gi, "");
  if (!value) return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    value = value.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    value = value.split(".").join("").replace(",", ".");
  } else if ((value.match(/\./g) ?? []).length > 1) {
    value = value.split(".").join("");
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(value)) return null;
  const amount = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(amount) ? amount : null;
}

/** Extracto separado por ";" con cabecera: fecha;importe;concepto (el concepto puede contener ";"). */
export function parseBankCsv(content: string): BankCsvRow[] {
  const lines = content
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) return [];

  const rows: BankCsvRow[] = [];
  for (const line of lines.slice(1, 5_001)) {
    const [postedAtRaw, amountRaw, ...descriptionParts] = line.split(";");
    const descriptionRaw = descriptionParts.join(";");
    if (!postedAtRaw || !amountRaw || !descriptionRaw.trim()) continue;
    const amount = parseBankAmount(amountRaw);
    if (amount === null || amount === 0) continue;
    const postedAt = parseBankDate(postedAtRaw);
    if (!postedAt) continue;
    rows.push({ postedAt, amount, description: unquote(descriptionRaw).slice(0, 500) });
  }
  return rows;
}
