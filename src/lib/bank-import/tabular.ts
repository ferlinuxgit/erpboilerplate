import type { BankImportMappingSnapshot } from "@/db/schema";
import type { ImportedMovement, ParsedStatement, SkippedRow } from "@/lib/bank-import/types";

/**
 * Extractos tabulares (CSV de cualquier banco o Excel convertido a filas de texto):
 * detección de separador, fila de cabecera, columnas, formato de fecha y de decimales, y
 * conversión a movimientos con el mapeo elegido por el usuario. Funciones puras.
 */

export type BankImportMapping = BankImportMappingSnapshot;
export type DateFormat = BankImportMapping["dateFormat"];
export type DecimalSeparator = BankImportMapping["decimalSeparator"];

export const MAX_IMPORT_ROWS = 5_000;

/** Texto de un fichero: UTF-8 si es válido; si no, Windows-1252 (habitual en bancos españoles). */
export function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function splitLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === "\"" && current.trim() === "") {
      quoted = true;
      current = "";
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Separador más probable: el que da el mismo número de columnas (> 1) en más líneas. */
export function detectDelimiter(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  let best = { delimiter: ";", score: -1 };
  for (const delimiter of [";", ",", "\t", "|"]) {
    const counts = lines.map((line) => splitLine(line, delimiter).length);
    const frequency = new Map<number, number>();
    for (const count of counts) if (count > 1) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    const [columns, lineCount] = [...frequency.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
    const score = lineCount * 100 + columns;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => (line.trim() ? splitLine(line, delimiter) : []));
  while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

const HEADER_PATTERNS = {
  valueDate: /valor/,
  date: /fecha|^f\.? ?(oper|contable)|^date|booking|^dia$/,
  amount: /importe|cantidad|amount|^euros?$|^eur$/,
  debit: /cargo|debe|debit|salida|pagos?$|reintegro|withdraw/,
  credit: /abono|haber|credit|entrada|ingresos?$|deposit/,
  balance: /saldo|balance/,
  reference: /referencia|^ref\b|documento|n\.? ?doc/,
  description: /concepto|descripcion|detalle|movimiento|observacion|beneficiario|ordenante|remitente|informacion|texto/,
};

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ.º ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerKind(value: string): keyof typeof HEADER_PATTERNS | null {
  const header = normalizeHeader(value);
  if (!header) return null;
  if (HEADER_PATTERNS.valueDate.test(header) && HEADER_PATTERNS.date.test(header)) return "valueDate";
  if (HEADER_PATTERNS.balance.test(header)) return "balance";
  if (HEADER_PATTERNS.date.test(header)) return "date";
  if (HEADER_PATTERNS.debit.test(header)) return "debit";
  if (HEADER_PATTERNS.credit.test(header)) return "credit";
  if (HEADER_PATTERNS.amount.test(header)) return "amount";
  if (HEADER_PATTERNS.reference.test(header)) return "reference";
  if (HEADER_PATTERNS.description.test(header)) return "description";
  return null;
}

/** Primera fila (de las 15 primeras) con al menos dos títulos reconocibles; -1 si no hay cabecera. */
export function detectHeaderRow(table: string[][]) {
  for (let index = 0; index < Math.min(table.length, 15); index += 1) {
    const kinds = new Set(table[index].map(headerKind).filter(Boolean));
    if (kinds.size >= 2 && (kinds.has("date") || kinds.has("amount") || kinds.has("debit") || kinds.has("credit"))) return index;
  }
  return -1;
}

const DATE_PATTERN = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T].*)?$/;

/** Formato de fecha de una columna: día > 12 en primera posición ⇒ dd/mm; en segunda ⇒ mm/dd. */
export function detectDateFormat(values: string[]): DateFormat {
  let dmy = 0;
  let mdy = 0;
  let ymd = 0;
  for (const raw of values) {
    const match = DATE_PATTERN.exec(raw.trim());
    if (!match) continue;
    if (match[1].length === 4) {
      ymd += 1;
      continue;
    }
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) dmy += 1;
    else if (second > 12 && first <= 12) mdy += 1;
  }
  if (ymd > dmy && ymd > mdy) return "YMD";
  return mdy > dmy ? "MDY" : "DMY";
}

/** Fecha según el formato elegido → medianoche UTC. Admite años de 2 dígitos y hora final. */
export function parseDateWith(raw: string, format: DateFormat): Date | null {
  const match = DATE_PATTERN.exec(raw.trim());
  if (!match) return null;
  let year: number;
  let month: number;
  let day: number;
  if (match[1].length === 4) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (format === "MDY") {
    [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (match[3].length === 2 && match[1].length !== 4) year += year < 80 ? 2000 : 1900;
  if (String(year).length !== 4) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function cleanNumber(raw: string) {
  return raw.replace(/[\s €]|EUR/gi, "");
}

/** Separador decimal de una columna: el último "," o "." seguido de 1-2 cifras vota. */
export function detectDecimalSeparator(values: string[]): DecimalSeparator {
  let comma = 0;
  let dot = 0;
  for (const raw of values) {
    const value = cleanNumber(raw);
    if (/,\d{1,2}-?\)?$/.test(value)) comma += 1;
    else if (/\.\d{1,2}-?\)?$/.test(value)) dot += 1;
    else if (/\d\.\d{3},/.test(value)) comma += 1;
    else if (/\d,\d{3}\./.test(value)) dot += 1;
  }
  return dot > comma ? "." : ",";
}

/** Importe con el separador decimal elegido. Admite "-", "+", "(12,50)" y "12,50-". */
export function parseAmountWith(raw: string, decimal: DecimalSeparator): number | null {
  let value = cleanNumber(raw);
  if (!value) return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.endsWith("-")) {
    negative = !negative;
    value = value.slice(0, -1);
  }
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }
  const thousands = decimal === "," ? "." : ",";
  value = value.split(thousands).join("");
  if (decimal === ",") value = value.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const amount = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(amount)) return null;
  return negative ? -amount : amount;
}

function columnValues(table: string[][], headerRow: number, column: number, limit = 200) {
  return table.slice(headerRow + 1, headerRow + 1 + limit).map((row) => row[column] ?? "").filter((value) => value.trim());
}

/** Propuesta de mapeo por títulos de columna y, si no hay cabecera, por el contenido. */
export function guessMapping(table: string[][], headerRow = detectHeaderRow(table)): BankImportMapping {
  const headers = headerRow >= 0 ? table[headerRow] : [];
  const columnCount = Math.max(0, ...table.slice(0, 50).map((row) => row.length));
  const mapping: BankImportMapping = {
    headerRow,
    dateColumn: -1,
    valueDateColumn: null,
    amountColumn: null,
    debitColumn: null,
    creditColumn: null,
    descriptionColumns: [],
    balanceColumn: null,
    referenceColumn: null,
    dateFormat: "DMY",
    decimalSeparator: ",",
    invertSign: false,
    headers: headers.map((header) => header.trim()),
  };

  headers.forEach((header, column) => {
    const kind = headerKind(header);
    if (kind === "date" && mapping.dateColumn < 0) mapping.dateColumn = column;
    else if (kind === "valueDate" && mapping.valueDateColumn === null) mapping.valueDateColumn = column;
    else if (kind === "amount" && mapping.amountColumn === null) mapping.amountColumn = column;
    else if (kind === "debit" && mapping.debitColumn === null) mapping.debitColumn = column;
    else if (kind === "credit" && mapping.creditColumn === null) mapping.creditColumn = column;
    else if (kind === "balance" && mapping.balanceColumn === null) mapping.balanceColumn = column;
    else if (kind === "reference" && mapping.referenceColumn === null) mapping.referenceColumn = column;
    else if (kind === "description") mapping.descriptionColumns.push(column);
  });
  if (mapping.dateColumn < 0 && typeof mapping.valueDateColumn === "number") {
    mapping.dateColumn = mapping.valueDateColumn;
    mapping.valueDateColumn = null;
  }
  if (mapping.amountColumn !== null && (mapping.debitColumn !== null || mapping.creditColumn !== null)) {
    // Con columna de importe única, "cargo/abono" suelen ser un indicador de texto: se usa el importe.
    mapping.debitColumn = null;
    mapping.creditColumn = null;
  }

  // Sin cabecera (o columnas sin reconocer): se deduce por el contenido.
  const sample = (column: number) => columnValues(table, headerRow, column, 50);
  const ratio = (column: number, test: (value: string) => boolean) => {
    const values = sample(column);
    return values.length ? values.filter(test).length / values.length : 0;
  };
  const isDate = (value: string) => DATE_PATTERN.test(value.trim());
  const isNumber = (value: string) => parseAmountWith(value, detectDecimalSeparator([value])) !== null;
  const used = () => new Set([mapping.dateColumn, mapping.valueDateColumn, mapping.amountColumn, mapping.debitColumn, mapping.creditColumn, mapping.balanceColumn, mapping.referenceColumn, ...mapping.descriptionColumns]);
  if (mapping.dateColumn < 0) {
    for (let column = 0; column < columnCount; column += 1) {
      if (ratio(column, isDate) >= 0.8) {
        mapping.dateColumn = column;
        break;
      }
    }
  }
  if (mapping.amountColumn === null && mapping.debitColumn === null && mapping.creditColumn === null) {
    for (let column = 0; column < columnCount; column += 1) {
      if (!used().has(column) && ratio(column, isNumber) >= 0.8) {
        mapping.amountColumn = column;
        break;
      }
    }
  }
  if (mapping.descriptionColumns.length === 0) {
    let best = { column: -1, length: 0 };
    for (let column = 0; column < columnCount; column += 1) {
      if (used().has(column)) continue;
      const values = sample(column);
      const textual = values.filter((value) => !isDate(value) && !isNumber(value));
      const length = textual.reduce((sum, value) => sum + value.length, 0) / Math.max(values.length, 1);
      if (textual.length >= values.length * 0.5 && length > best.length) best = { column, length };
    }
    if (best.column >= 0) mapping.descriptionColumns = [best.column];
  }

  if (mapping.dateColumn >= 0) mapping.dateFormat = detectDateFormat(columnValues(table, headerRow, mapping.dateColumn));
  const amountColumns = [mapping.amountColumn, mapping.debitColumn, mapping.creditColumn, mapping.balanceColumn].filter((column): column is number => column !== null && column !== undefined);
  mapping.decimalSeparator = detectDecimalSeparator(amountColumns.flatMap((column) => columnValues(table, headerRow, column)));
  return mapping;
}

/** Errores de un mapeo antes de importar (en lenguaje llano). */
export function validateMapping(mapping: BankImportMapping) {
  const errors: string[] = [];
  if (mapping.dateColumn < 0) errors.push("Elige la columna con la fecha del movimiento.");
  const hasAmount = mapping.amountColumn !== null && mapping.amountColumn !== undefined;
  const hasSplit = (mapping.debitColumn ?? null) !== null || (mapping.creditColumn ?? null) !== null;
  if (!hasAmount && !hasSplit) errors.push("Elige la columna del importe, o las columnas de cargos y abonos.");
  if (mapping.descriptionColumns.length === 0) errors.push("Elige al menos una columna con el concepto.");
  return errors;
}

function cell(row: string[], column: number | null | undefined) {
  if (column === null || column === undefined || column < 0) return "";
  return (row[column] ?? "").trim();
}

/** Convierte las filas con el mapeo: cada fila descartada lleva su motivo. */
export function applyMapping(table: string[][], mapping: BankImportMapping): ParsedStatement {
  const movements: ImportedMovement[] = [];
  const skipped: SkippedRow[] = [];
  const rows = table.slice(mapping.headerRow + 1);
  rows.forEach((row, offset) => {
    const line = mapping.headerRow + 2 + offset;
    if (row.every((value) => !value.trim())) return;
    if (movements.length >= MAX_IMPORT_ROWS) {
      skipped.push({ line, reason: `Se superó el máximo de ${MAX_IMPORT_ROWS} movimientos por importación.` });
      return;
    }
    const rawDate = cell(row, mapping.dateColumn);
    const postedAt = parseDateWith(rawDate, mapping.dateFormat);
    if (!postedAt) {
      skipped.push({ line, reason: rawDate ? `Fecha no reconocida: «${rawDate.slice(0, 30)}».` : "Fila sin fecha (probablemente un total o una nota)." });
      return;
    }
    let amount: number | null;
    if (mapping.amountColumn !== null && mapping.amountColumn !== undefined) {
      amount = parseAmountWith(cell(row, mapping.amountColumn), mapping.decimalSeparator);
    } else {
      const debit = parseAmountWith(cell(row, mapping.debitColumn), mapping.decimalSeparator);
      const credit = parseAmountWith(cell(row, mapping.creditColumn), mapping.decimalSeparator);
      amount = debit === null && credit === null ? null : Math.round(((credit ?? 0) - Math.abs(debit ?? 0)) * 100) / 100;
    }
    if (amount === null) {
      skipped.push({ line, reason: "Importe vacío o no numérico." });
      return;
    }
    if (mapping.invertSign) amount = -amount;
    if (amount === 0) {
      skipped.push({ line, reason: "Importe cero." });
      return;
    }
    const description = mapping.descriptionColumns.map((column) => cell(row, column)).filter(Boolean).join(" · ");
    const balanceRaw = cell(row, mapping.balanceColumn);
    const valueDateRaw = cell(row, mapping.valueDateColumn);
    movements.push({
      line,
      postedAt,
      valueDate: valueDateRaw ? parseDateWith(valueDateRaw, mapping.dateFormat) : null,
      amount,
      description: (description || "Movimiento sin concepto").slice(0, 500),
      reference: cell(row, mapping.referenceColumn) || null,
      balanceAfter: balanceRaw ? parseAmountWith(balanceRaw, mapping.decimalSeparator) : null,
    });
  });
  return { movements, skipped };
}
