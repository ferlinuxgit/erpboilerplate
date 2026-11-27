/**
 * ESTADO DE CAMBIOS EN EL PATRIMONIO NETO (funciones puras).
 *
 * Columnas y filas de los modelos del BOE: «Estado abreviado total de cambios en el patrimonio neto»
 * y «Estado total de cambios en el patrimonio neto» (PGC, RD 1514/2007, tercera parte) y «Estado de
 * cambios en el patrimonio neto de PYMES» (RD 1515/2007). Desde la Ley 22/2015 (art. 257.3 LSC) el
 * estado no es obligatorio para quien formula balance abreviado o de PYMES; se ofrece igualmente.
 *
 * De dónde sale cada fila (no hay más información en la contabilidad que los propios asientos):
 * - Saldos inicial y final: saldos de las cuentas de patrimonio neto (subgrupos 10 a 13 y 557).
 * - Resultado: el de la cuenta de pérdidas y ganancias (grupos 6 y 7), en la columna «Resultado».
 * - Cada asiento del ejercicio que mueve cuentas de patrimonio se clasifica por su efecto:
 *     · no cambia el total del patrimonio (reparto del resultado a reservas, compensación de
 *       pérdidas…) → «Otras variaciones del patrimonio neto»;
 *     · mueve capital o prima de emisión → aumento o reducción de capital según el signo;
 *     · solo mueve subvenciones o ajustes por cambios de valor → ingresos y gastos reconocidos;
 *     · el resto (dividendos, aportaciones de socios, acciones propias) → operaciones con socios.
 *   Es una clasificación automática: hay que revisarla antes de formular las cuentas.
 * - Los ajustes por cambios de criterio y por errores no se pueden deducir de los asientos: se
 *   muestran a cero.
 * - El resultado de un ejercicio anterior que nunca se regularizó entra en el saldo inicial de la
 *   columna «Resultado» y pasa a «Resultados de ejercicios anteriores» como otra variación, igual que
 *   lo presenta el balance.
 */

import type { OfficialStatementModelId } from "@/server/accounting/official-statements-model";

export type EquityColumnId =
  | "capital" | "uncalled" | "premium" | "reserves" | "ownShares" | "priorResults" | "contributions"
  | "result" | "interimDividend" | "otherInstruments" | "valueAdjustments" | "grants";

const COLUMN_LABELS: Record<EquityColumnId, string> = {
  capital: "Capital escriturado",
  uncalled: "(Capital no exigido)",
  premium: "Prima de emisión",
  reserves: "Reservas",
  ownShares: "(Acciones y participaciones en patrimonio propias)",
  priorResults: "Resultados de ejercicios anteriores",
  contributions: "Otras aportaciones de socios",
  result: "Resultado del ejercicio",
  interimDividend: "(Dividendo a cuenta)",
  otherInstruments: "Otros instrumentos de patrimonio neto",
  valueAdjustments: "Ajustes por cambios de valor",
  grants: "Subvenciones, donaciones y legados recibidos",
};

const FULL_COLUMNS: EquityColumnId[] = ["capital", "uncalled", "premium", "reserves", "ownShares", "priorResults", "contributions", "result", "interimDividend", "otherInstruments", "valueAdjustments", "grants"];
const PYMES_COLUMNS: EquityColumnId[] = ["capital", "uncalled", "premium", "reserves", "ownShares", "priorResults", "contributions", "result", "interimDividend", "grants"];

/** Prefijo de cuenta → columna (gana el prefijo más largo). */
const FULL_PREFIXES: Array<[string, EquityColumnId]> = [
  ["100", "capital"], ["101", "capital"], ["102", "capital"],
  ["1030", "uncalled"], ["1040", "uncalled"],
  ["110", "premium"],
  ["112", "reserves"], ["113", "reserves"], ["114", "reserves"], ["115", "reserves"], ["119", "reserves"],
  ["108", "ownShares"], ["109", "ownShares"],
  ["120", "priorResults"], ["121", "priorResults"],
  ["118", "contributions"],
  ["129", "result"],
  ["557", "interimDividend"],
  ["111", "otherInstruments"],
  ["133", "valueAdjustments"], ["134", "valueAdjustments"], ["135", "valueAdjustments"], ["136", "valueAdjustments"], ["137", "valueAdjustments"],
  ["8", "valueAdjustments"], ["9", "valueAdjustments"],
  ["130", "grants"], ["131", "grants"], ["132", "grants"], ["84", "grants"], ["94", "grants"],
];

/** El modelo de PYMES no tiene columnas de otros instrumentos ni de ajustes: van donde su balance. */
const PYMES_OVERRIDES: Partial<Record<EquityColumnId, EquityColumnId>> = { otherInstruments: "contributions", valueAdjustments: "reserves" };

export function equityColumns(model: OfficialStatementModelId) {
  return (model === "pymes" ? PYMES_COLUMNS : FULL_COLUMNS).map((id) => ({ id, label: COLUMN_LABELS[id] }));
}

/** Columna del estado a la que pertenece una cuenta; null si no es de patrimonio neto. */
export function equityColumnOf(code: string, model: OfficialStatementModelId): EquityColumnId | null {
  let best: [string, EquityColumnId] | null = null;
  for (const candidate of FULL_PREFIXES) {
    if (code.startsWith(candidate[0]) && (!best || candidate[0].length > best[0].length)) best = candidate;
  }
  if (!best) return null;
  return model === "pymes" ? PYMES_OVERRIDES[best[1]] ?? best[1] : best[1];
}

/** ¿Hay que traer los movimientos de esta cuenta para el estado? (prefijos para la consulta). */
export const EQUITY_ACCOUNT_PREFIXES = ["10", "11", "12", "13", "557", "8", "9"];

export type EquityMovementKind =
  | "recognized" | "capitalIncrease" | "capitalReduction" | "debtConversion" | "dividends"
  | "ownShares" | "businessCombination" | "otherOwners" | "other";

type RowDefinition = { id: string; label: string; kind?: EquityMovementKind | "result" | "resultAndRecognized"; group?: boolean };

const OWNER_ROWS_SHORT: RowDefinition[] = [
  { id: "owners.1", label: "1. Aumentos de capital", kind: "capitalIncrease" },
  { id: "owners.2", label: "2. (−) Reducciones de capital", kind: "capitalReduction" },
  { id: "owners.3", label: "3. Otras operaciones con socios o propietarios", kind: "otherOwners" },
];

const MOVEMENT_ROWS: Record<OfficialStatementModelId, RowDefinition[]> = {
  abbreviated: [
    { id: "recognized", label: "I. Total ingresos y gastos reconocidos", kind: "resultAndRecognized" },
    { id: "owners", label: "II. Operaciones con socios o propietarios", group: true },
    ...OWNER_ROWS_SHORT,
    { id: "other", label: "III. Otras variaciones del patrimonio neto", kind: "other" },
  ],
  pymes: [
    { id: "result", label: "I. Resultado de la cuenta de pérdidas y ganancias", kind: "result" },
    { id: "recognized", label: "II. Ingresos y gastos reconocidos en el patrimonio neto", kind: "recognized" },
    { id: "owners", label: "III. Operaciones con socios o propietarios", group: true },
    ...OWNER_ROWS_SHORT,
    { id: "other", label: "IV. Otras variaciones del patrimonio neto", kind: "other" },
  ],
  normal: [
    { id: "recognized", label: "I. Total ingresos y gastos reconocidos", kind: "resultAndRecognized" },
    { id: "owners", label: "II. Operaciones con socios o propietarios", group: true },
    { id: "owners.1", label: "1. Aumentos de capital", kind: "capitalIncrease" },
    { id: "owners.2", label: "2. (−) Reducciones de capital", kind: "capitalReduction" },
    { id: "owners.3", label: "3. Conversión de pasivos financieros en patrimonio neto (conversión de obligaciones, condonaciones de deudas)", kind: "debtConversion" },
    { id: "owners.4", label: "4. (−) Distribución de dividendos", kind: "dividends" },
    { id: "owners.5", label: "5. Operaciones con acciones o participaciones propias (netas)", kind: "ownShares" },
    { id: "owners.6", label: "6. Incremento (reducción) de patrimonio neto resultante de una combinación de negocios", kind: "businessCombination" },
    { id: "owners.7", label: "7. Otras operaciones con socios o propietarios", kind: "otherOwners" },
    { id: "other", label: "III. Otras variaciones del patrimonio neto", kind: "other" },
  ],
};

type Deltas = Partial<Record<EquityColumnId, number>>;

/** Clasifica un asiento por su efecto en el patrimonio (importes en céntimos, haber en positivo). */
export function classifyEquityEntry(deltas: Deltas, model: OfficialStatementModelId): EquityMovementKind {
  const touched = (Object.keys(deltas) as EquityColumnId[]).filter((column) => (deltas[column] ?? 0) !== 0);
  const total = touched.reduce((sum, column) => sum + (deltas[column] ?? 0), 0);
  if (total === 0) return "other";
  if (touched.some((column) => column === "capital" || column === "uncalled" || column === "premium")) {
    return total > 0 ? "capitalIncrease" : "capitalReduction";
  }
  if (touched.every((column) => column === "grants" || column === "valueAdjustments")) return "recognized";
  if (model === "normal") {
    if (touched.includes("ownShares")) return "ownShares";
    if (total < 0 && touched.every((column) => column === "result" || column === "reserves" || column === "priorResults" || column === "interimDividend")) return "dividends";
  }
  return "otherOwners";
}

export type EquityYearInput = {
  /** Etiqueta del ejercicio («2026»). */
  label: string;
  /** Saldos al inicio del ejercicio por cuenta, en céntimos con el haber en positivo. */
  opening: Array<{ code: string; cents: number }>;
  /** Resultado de años anteriores nunca regularizado (grupos 6 y 7 antes del inicio), haber en positivo. */
  pendingPriorResultCents: number;
  /** Resultado del ejercicio (beneficio en positivo). */
  yearResultCents: number;
  /** Asientos del ejercicio que tocan cuentas de patrimonio (sin regularización, cierre ni apertura). */
  entries: Array<{ entryId: string; lines: Array<{ code: string; debitCents: number; creditCents: number }> }>;
};

export type EquityStatementRow = {
  id: string;
  label: string;
  kind: "balance" | "movement" | "group";
  /** Importe por columna en euros (vacío en las filas de grupo). */
  values: Partial<Record<EquityColumnId, number>>;
  total: number;
};

export type EquityYearStatement = { label: string; opening: EquityStatementRow; movements: EquityStatementRow[]; closing: EquityStatementRow };

const euros = (cents: number) => Math.round(cents) / 100 + 0;

function toRow(id: string, label: string, kind: EquityStatementRow["kind"], cents: Deltas, columns: EquityColumnId[]): EquityStatementRow {
  const values: Partial<Record<EquityColumnId, number>> = {};
  let total = 0;
  for (const column of columns) {
    const value = cents[column] ?? 0;
    values[column] = euros(value);
    total += value;
  }
  return { id, label, kind, values: kind === "group" ? {} : values, total: kind === "group" ? 0 : euros(total) };
}

function add(target: Deltas, column: EquityColumnId, cents: number) {
  if (cents !== 0) target[column] = (target[column] ?? 0) + cents;
}

/** Movimientos de un ejercicio: saldo inicial, variaciones por fila del modelo y saldo final. */
export function buildEquityYear(input: EquityYearInput, model: OfficialStatementModelId): EquityYearStatement {
  const columns = equityColumns(model).map((column) => column.id);
  const opening: Deltas = {};
  for (const account of input.opening) {
    const column = equityColumnOf(account.code, model);
    if (column) add(opening, column, account.cents);
  }
  add(opening, "result", input.pendingPriorResultCents);

  const byKind = new Map<string, Deltas>();
  const bucket = (kind: string) => {
    let deltas = byKind.get(kind);
    if (!deltas) byKind.set(kind, (deltas = {}));
    return deltas;
  };

  add(bucket("result"), "result", input.yearResultCents);
  if (input.pendingPriorResultCents !== 0) {
    add(bucket("other"), "result", -input.pendingPriorResultCents);
    add(bucket("other"), "priorResults", input.pendingPriorResultCents);
  }
  for (const entry of input.entries) {
    const deltas: Deltas = {};
    for (const line of entry.lines) {
      const column = equityColumnOf(line.code, model);
      if (column) add(deltas, column, line.creditCents - line.debitCents);
    }
    const target = bucket(classifyEquityEntry(deltas, model));
    for (const column of Object.keys(deltas) as EquityColumnId[]) add(target, column, deltas[column] ?? 0);
  }

  const closing: Deltas = { ...opening };
  for (const deltas of byKind.values()) for (const column of Object.keys(deltas) as EquityColumnId[]) add(closing, column, deltas[column] ?? 0);

  const movements = MOVEMENT_ROWS[model].map((definition) => {
    if (definition.group) return toRow(definition.id, definition.label, "group", {}, columns);
    const cents: Deltas = {};
    const kinds = definition.kind === "resultAndRecognized" ? ["result", "recognized"] : [definition.kind ?? ""];
    for (const kind of kinds) {
      const deltas = byKind.get(kind);
      if (deltas) for (const column of Object.keys(deltas) as EquityColumnId[]) add(cents, column, deltas[column] ?? 0);
    }
    return toRow(definition.id, definition.label, "movement", cents, columns);
  });

  return {
    label: input.label,
    opening: toRow("opening", `SALDO AJUSTADO, INICIO DEL AÑO ${input.label}`, "balance", opening, columns),
    movements,
    closing: toRow("closing", `SALDO, FINAL DEL AÑO ${input.label}`, "balance", closing, columns),
  };
}

export type EquityChangesStatement = {
  model: OfficialStatementModelId;
  columns: Array<{ id: EquityColumnId; label: string }>;
  /** Filas A a E del modelo: ejercicio anterior (si lo hay) y ejercicio actual. */
  rows: EquityStatementRow[];
};

/** Estado completo con las letras del modelo oficial (A-C: ejercicio anterior; C-E: ejercicio actual). */
export function buildEquityChangesStatement(current: EquityYearInput, previous: EquityYearInput | null, model: OfficialStatementModelId): EquityChangesStatement {
  const columnDefs = equityColumns(model);
  const columns = columnDefs.map((column) => column.id);
  const rows: EquityStatementRow[] = [];
  const zero = (id: string, label: string) => toRow(id, label, "movement", {}, columns);
  const pushYear = (year: EquityYearStatement, prefix: string, letters: [string, string], closingLetter: string, closingBefore: EquityStatementRow | null) => {
    if (closingBefore) rows.push(closingBefore);
    rows.push(zero(`${prefix}.criteria`, "I. Ajustes por cambios de criterio"), zero(`${prefix}.errors`, "II. Ajustes por errores"));
    rows.push({ ...year.opening, id: `${prefix}.opening`, label: `${letters[1]}. ${year.opening.label}` });
    rows.push(...year.movements.map((row) => ({ ...row, id: `${prefix}.${row.id}` })));
    return { ...year.closing, id: `${prefix}.closing`, label: `${closingLetter}. ${year.closing.label}` };
  };

  const currentYear = buildEquityYear(current, model);
  if (previous) {
    const previousYear = buildEquityYear(previous, model);
    const before: EquityStatementRow = { ...previousYear.opening, id: "previous.before", label: "A. SALDO, FINAL DEL AÑO ANTERIOR" };
    const closingPrevious = pushYear(previousYear, "previous", ["A", "B"], "C", before);
    rows.push(pushYear(currentYear, "current", ["C", "D"], "E", closingPrevious));
  } else {
    const before: EquityStatementRow = { ...currentYear.opening, id: "current.before", label: "C. SALDO, FINAL DEL AÑO ANTERIOR" };
    rows.push(pushYear(currentYear, "current", ["C", "D"], "E", before));
  }
  return { model, columns: columnDefs, rows };
}

/**
 * ESTADO DE INGRESOS Y GASTOS RECONOCIDOS (modelo normal y abreviado del PGC; el de PYMES no lo tiene).
 * Reparto de la columna «N.º cuentas» del BOE. Los grupos 8 y 9 se saldan al cierre contra el
 * subgrupo 13, así que se toma lo cargado en las cuentas de gastos (grupo 8) y lo abonado en las de
 * ingresos (grupo 9): los traspasos de cierre van por el lado contrario y no cuentan.
 */
type RecognizedLine = { id: string; label: string; accounts?: string[]; totalOf?: string[]; result?: boolean; depth: number };

const RECOGNIZED_DIRECT = ["R.I", "R.II", "R.III", "R.IV", "R.V"];
const RECOGNIZED_TRANSFERS = ["R.VI", "R.VII", "R.VIII", "R.IX"];

const RECOGNIZED_LINES: RecognizedLine[] = [
  { id: "R.A", label: "A) Resultado de la cuenta de pérdidas y ganancias", result: true, depth: 0 },
  { id: "R.I", label: "I. Por valoración de instrumentos financieros", accounts: ["800", "89", "900", "991", "992"], depth: 1 },
  { id: "R.II", label: "II. Por coberturas de flujos de efectivo", accounts: ["810", "910"], depth: 1 },
  { id: "R.III", label: "III. Subvenciones, donaciones y legados recibidos", accounts: ["94"], depth: 1 },
  { id: "R.IV", label: "IV. Por ganancias y pérdidas actuariales y otros ajustes", accounts: ["85", "95"], depth: 1 },
  { id: "R.V", label: "V. Efecto impositivo", accounts: ["8300", "8301", "833", "834", "835", "838"], depth: 1 },
  { id: "R.B", label: "B) Total ingresos y gastos imputados directamente en el patrimonio neto (I + II + III + IV + V)", totalOf: RECOGNIZED_DIRECT, depth: 0 },
  { id: "R.VI", label: "VI. Por valoración de instrumentos financieros", accounts: ["802", "902", "993", "994"], depth: 1 },
  { id: "R.VII", label: "VII. Por coberturas de flujos de efectivo", accounts: ["812", "912"], depth: 1 },
  { id: "R.VIII", label: "VIII. Subvenciones, donaciones y legados recibidos", accounts: ["84"], depth: 1 },
  { id: "R.IX", label: "IX. Efecto impositivo", accounts: ["836", "837"], depth: 1 },
  { id: "R.C", label: "C) Total transferencias a la cuenta de pérdidas y ganancias (VI + VII + VIII + IX)", totalOf: RECOGNIZED_TRANSFERS, depth: 0 },
  { id: "R.TOTAL", label: "TOTAL DE INGRESOS Y GASTOS RECONOCIDOS (A + B + C)", totalOf: ["R.A", ...RECOGNIZED_DIRECT, ...RECOGNIZED_TRANSFERS], depth: 0 },
];

export type RecognizedIncomeLine = { id: string; label: string; depth: number; kind: "line" | "total"; amount: number; previous: number | null };

type RecognizedInput = { yearResultCents: number; accounts: Array<{ code: string; debitCents: number; creditCents: number }> };

function recognizedCents(input: RecognizedInput) {
  const cents = new Map<string, number>();
  const unassigned: string[] = [];
  cents.set("R.A", input.yearResultCents);
  for (const account of input.accounts) {
    if (!account.code.startsWith("8") && !account.code.startsWith("9")) continue;
    // Gastos (grupo 8): lo cargado, en negativo. Ingresos (grupo 9): lo abonado, en positivo.
    const amount = account.code.startsWith("8") ? -account.debitCents : account.creditCents;
    if (amount === 0) continue;
    let best: RecognizedLine | null = null;
    let bestLength = 0;
    for (const line of RECOGNIZED_LINES) {
      for (const prefix of line.accounts ?? []) {
        if (account.code.startsWith(prefix) && prefix.length > bestLength) {
          best = line;
          bestLength = prefix.length;
        }
      }
    }
    if (!best) {
      unassigned.push(account.code);
      continue;
    }
    cents.set(best.id, (cents.get(best.id) ?? 0) + amount);
  }
  const value = (line: RecognizedLine): number => line.totalOf
    ? line.totalOf.reduce((sum, id) => sum + (cents.get(id) ?? 0), 0)
    : cents.get(line.id) ?? 0;
  return { value, unassigned };
}

export function buildRecognizedIncomeStatement(current: RecognizedInput, previous: RecognizedInput | null) {
  const now = recognizedCents(current);
  const before = previous ? recognizedCents(previous) : null;
  const lines: RecognizedIncomeLine[] = RECOGNIZED_LINES.map((line) => ({
    id: line.id,
    label: line.label,
    depth: line.depth,
    kind: line.totalOf ? "total" : "line",
    amount: euros(now.value(line)),
    previous: before ? euros(before.value(line)) : null,
  }));
  /** Cuentas de los grupos 8 y 9 con movimiento que la tabla del BOE no asigna a ninguna partida. */
  return { lines, unassigned: [...new Set(now.unassigned)].sort() };
}
