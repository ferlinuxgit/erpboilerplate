import type { ImportedMovement, SkippedRow } from "@/lib/bank-import/types";

/**
 * Cuaderno 43 de la AEB (Norma 43): extracto de movimientos en registros de 80 posiciones.
 *
 * - 11: cabecera de cuenta (entidad, oficina, cuenta, fechas, saldo inicial, divisa, titular).
 * - 22: movimiento (fechas operación/valor, conceptos, debe/haber, importe, documento, referencias).
 * - 23: conceptos complementarios del movimiento anterior (hasta 5 registros, 2 × 38 caracteres).
 * - 24: equivalencia de divisa (se ignora).
 * - 33: final de cuenta (totales y saldo final).
 * - 88: fin de fichero.
 */

export type Norma43Account = {
  bankCode: string;
  branchCode: string;
  accountNumber: string;
  currency: string;
  holderName: string;
  startDate: Date | null;
  endDate: Date | null;
  initialBalance: number;
  finalBalance: number | null;
  movements: ImportedMovement[];
};

export type Norma43Result = {
  accounts: Norma43Account[];
  skipped: SkippedRow[];
  warnings: string[];
};

/** Conceptos comunes AEB (posiciones 23-24 del registro 22), en lenguaje llano. */
export const NORMA43_COMMON_CONCEPTS: Record<string, string> = {
  "01": "Talones / reintegros",
  "02": "Ingresos / abonarés",
  "03": "Recibos domiciliados",
  "04": "Transferencias / traspasos",
  "05": "Amortización de préstamo",
  "06": "Remesa de efectos",
  "07": "Suscripciones / canjes",
  "08": "Dividendos / cupones",
  "09": "Operaciones de bolsa",
  "10": "Cheques gasolina",
  "11": "Cajero automático",
  "12": "Tarjeta de crédito o débito",
  "13": "Operaciones con el extranjero",
  "14": "Devoluciones e impagados",
  "15": "Nóminas / seguros sociales",
  "16": "Timbres / corretaje / póliza",
  "17": "Intereses / comisiones / gastos",
  "98": "Anulación / corrección",
  "99": "Varios",
};

const CURRENCIES: Record<string, string> = { "978": "EUR", "840": "USD", "826": "GBP", "756": "CHF" };

/** Heurística: el fichero parece Norma 43 si sus registros empiezan por 11 y contiene 22/33/88. */
export function looksLikeNorma43(content: string) {
  const lines = content.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2 || !lines[0].startsWith("11")) return false;
  return lines.every((line) => /^(11|22|23|24|33|88)/.test(line) && line.trimEnd().length <= 82)
    && lines.some((line) => line.startsWith("33") || line.startsWith("88") || line.startsWith("22"));
}

function field(line: string, start: number, end: number) {
  // Posiciones de la norma: base 1 e inclusivas.
  return line.slice(start - 1, end);
}

/** AAMMDD → fecha UTC (años 00-79 → 2000-2079). */
export function parseNorma43Date(value: string): Date | null {
  if (!/^\d{6}$/.test(value)) return null;
  const yy = Number(value.slice(0, 2));
  const year = yy < 80 ? 2000 + yy : 1900 + yy;
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/** 14 dígitos con 2 decimales implícitos; clave 1 = debe (negativo), 2 = haber (positivo). */
function parseSignedAmount(sign: string, digits: string): number | null {
  if (!/^\d{1,14}$/.test(digits.trim()) || (sign !== "1" && sign !== "2")) return null;
  const cents = Number(digits.trim());
  return (sign === "1" ? -cents : cents) / 100;
}

function roundCents(value: number) {
  return Math.round(value * 100) / 100;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/** Referencia útil: descarta rellenos de ceros o espacios. */
function cleanReference(value: string) {
  const text = cleanText(value);
  return /^0*$/.test(text) ? "" : text;
}

export function parseNorma43(content: string): Norma43Result {
  const accounts: Norma43Account[] = [];
  const skipped: SkippedRow[] = [];
  const warnings: string[] = [];
  let current: Norma43Account | null = null;
  let balance = 0;
  let lastMovement: (ImportedMovement & { concepts: string[]; fallback: string }) | null = null;
  const pending: Array<{ account: Norma43Account; movement: ImportedMovement & { concepts: string[]; fallback: string } }> = [];

  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    if (raw.trim().length === 0) return;
    const line = raw.padEnd(80, " ");
    const type = line.slice(0, 2);

    if (type === "11") {
      const initial = parseSignedAmount(field(line, 33, 33), field(line, 34, 47)) ?? 0;
      current = {
        bankCode: field(line, 3, 6),
        branchCode: field(line, 7, 10),
        accountNumber: field(line, 11, 20),
        startDate: parseNorma43Date(field(line, 21, 26)),
        endDate: parseNorma43Date(field(line, 27, 32)),
        initialBalance: initial,
        currency: CURRENCIES[field(line, 48, 50)] ?? field(line, 48, 50),
        holderName: cleanText(field(line, 52, 77)),
        finalBalance: null,
        movements: [],
      };
      accounts.push(current);
      balance = initial;
      lastMovement = null;
      return;
    }

    if (type === "22") {
      if (!current) {
        skipped.push({ line: lineNumber, reason: "Movimiento sin cabecera de cuenta (registro 11)." });
        return;
      }
      const postedAt = parseNorma43Date(field(line, 11, 16));
      const amount = parseSignedAmount(field(line, 28, 28), field(line, 29, 42));
      if (!postedAt) {
        skipped.push({ line: lineNumber, reason: "Fecha de operación no válida." });
        lastMovement = null;
        return;
      }
      if (amount === null) {
        skipped.push({ line: lineNumber, reason: "Importe o clave debe/haber no válidos." });
        lastMovement = null;
        return;
      }
      balance = roundCents(balance + amount);
      const commonConcept = field(line, 23, 24);
      const reference1 = cleanReference(field(line, 53, 64));
      const reference2 = cleanReference(field(line, 65, 80));
      const references = [reference2, reference1].filter(Boolean);
      lastMovement = {
        line: lineNumber,
        postedAt,
        valueDate: parseNorma43Date(field(line, 17, 22)),
        amount,
        description: "",
        reference: references.length ? references.join(" · ") : null,
        balanceAfter: balance,
        concepts: [],
        fallback: [NORMA43_COMMON_CONCEPTS[commonConcept] ?? "Movimiento bancario", ...references].join(" · "),
      };
      if (amount === 0) {
        skipped.push({ line: lineNumber, reason: "Movimiento con importe cero." });
        return;
      }
      pending.push({ account: current, movement: lastMovement });
      return;
    }

    if (type === "23") {
      if (!lastMovement) return;
      const text = cleanText(`${field(line, 5, 42)} ${field(line, 43, 80)}`);
      if (text) lastMovement.concepts.push(text);
      return;
    }

    if (type === "24") return;

    if (type === "33") {
      if (!current) return;
      const finalBalance = parseSignedAmount(field(line, 59, 59), field(line, 60, 73));
      current.finalBalance = finalBalance;
      if (finalBalance !== null && roundCents(finalBalance) !== roundCents(balance)) {
        warnings.push(
          `La cuenta ${current.accountNumber} declara un saldo final de ${finalBalance.toFixed(2)} y la suma de movimientos da ${balance.toFixed(2)}. Revisa que el fichero esté completo.`,
        );
      }
      lastMovement = null;
      return;
    }

    if (type === "88") return;
    skipped.push({ line: lineNumber, reason: `Registro de tipo "${type.trim()}" desconocido en Norma 43.` });
  });

  for (const { account, movement } of pending) {
    const { concepts, fallback, ...rest } = movement;
    account.movements.push({ ...rest, description: (concepts.length ? concepts.join(" ") : fallback).slice(0, 500) });
  }

  return { accounts, skipped, warnings };
}

/**
 * Cuenta de un IBAN español (ES + 2 control + entidad 4 + oficina 4 + DC 2 + cuenta 10), para
 * elegir en un fichero con varias cuentas la que corresponde a la cuenta bancaria de destino.
 */
export function matchesSpanishIban(account: Pick<Norma43Account, "bankCode" | "branchCode" | "accountNumber">, iban: string) {
  const normalized = iban.toUpperCase().replace(/\s+/g, "");
  if (!normalized.startsWith("ES") || normalized.length !== 24) return false;
  return normalized.slice(4, 8) === account.bankCode
    && normalized.slice(8, 12) === account.branchCode
    && normalized.slice(14, 24) === account.accountNumber;
}
