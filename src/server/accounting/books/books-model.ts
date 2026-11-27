/**
 * LIBROS OFICIALES DE CONTABILIDAD (funciones puras, sin base de datos).
 *
 * Código de Comercio:
 * - art. 25: todo empresario lleva un libro de Inventarios y Cuentas anuales y otro Diario;
 * - art. 28.1: el libro de Inventarios y Cuentas anuales se abre con el balance inicial detallado,
 *   recoge al menos trimestralmente los balances de comprobación con sumas y saldos y, al cierre,
 *   el inventario y las cuentas anuales;
 * - art. 28.2: el Diario registra día a día todas las operaciones;
 * - art. 27: los libros se legalizan en el Registro Mercantil dentro de los cuatro meses
 *   siguientes al cierre del ejercicio.
 * El Libro Mayor no es obligatorio: se genera como auxiliar.
 *
 * El Diario se presenta en orden cronológico con un NÚMERO DE ORDEN correlativo dentro del
 * ejercicio (1, 2, 3…): apertura, operaciones por fecha, regularización y cierre. El número interno
 * del asiento (AS-2026/000123) se conserva al lado, porque se asigna al crear el asiento y no tiene
 * por qué seguir el orden de las fechas.
 */

import { createHash } from "node:crypto";

export type BookEntryKind = "opening" | "normal" | "regularization" | "closing";

export type BookLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  concept: string | null;
  debitCents: number;
  creditCents: number;
};

export type BookEntry = {
  id: string;
  /** Número interno (AS-2026/000123). */
  number: string;
  postedAt: Date;
  /** Día contable (AAAA-MM-DD) en la hora local de la empresa. */
  day: string;
  reference: string | null;
  kind: BookEntryKind;
  lines: BookLine[];
};

export type OrderedBookEntry = BookEntry & { /** Número de orden correlativo en el Diario del ejercicio. */ order: number };

const SOURCE_KIND: Record<string, BookEntryKind> = {
  fiscalYearOpening: "opening",
  fiscalYearRegularization: "regularization",
  fiscalYearClosing: "closing",
};

export function bookEntryKind(sourceType: string | null | undefined): BookEntryKind {
  return SOURCE_KIND[sourceType ?? ""] ?? "normal";
}

/** Dentro de un mismo día: apertura primero; regularización y cierre al final. */
const KIND_RANK: Record<BookEntryKind, number> = { opening: 0, normal: 1, regularization: 2, closing: 3 };

/** Diario en orden cronológico con su número de orden; dentro de cada asiento, primero el debe. */
export function orderJournal(entries: BookEntry[]): OrderedBookEntry[] {
  return [...entries]
    .sort((a, b) => a.day.localeCompare(b.day)
      || KIND_RANK[a.kind] - KIND_RANK[b.kind]
      || a.postedAt.getTime() - b.postedAt.getTime()
      || a.number.localeCompare(b.number))
    .map((entry, index) => ({ ...entry, order: index + 1 }));
}

export type AccountBalance = { accountId: string; code: string; name: string; /** Debe − haber, en céntimos. */ balanceCents: number };

export type LedgerAccount = {
  accountId: string;
  code: string;
  name: string;
  openingCents: number;
  lines: Array<{ order: number; number: string; day: string; concept: string | null; debitCents: number; creditCents: number; balanceCents: number }>;
  debitCents: number;
  creditCents: number;
  closingCents: number;
};

/** Libro Mayor: movimientos de cada cuenta en el orden del Diario, con saldo acumulado. */
export function buildLedger(journal: OrderedBookEntry[], prior: AccountBalance[]): LedgerAccount[] {
  const accounts = new Map<string, LedgerAccount>();
  const account = (id: string, code: string, name: string) => {
    let current = accounts.get(id);
    if (!current) {
      current = { accountId: id, code, name, openingCents: 0, lines: [], debitCents: 0, creditCents: 0, closingCents: 0 };
      accounts.set(id, current);
    }
    return current;
  };
  for (const balance of prior) {
    if (balance.balanceCents === 0) continue;
    const current = account(balance.accountId, balance.code, balance.name);
    current.openingCents = balance.balanceCents;
    current.closingCents = balance.balanceCents;
  }
  for (const entry of journal) {
    for (const line of entry.lines) {
      const current = account(line.accountId, line.accountCode, line.accountName);
      current.debitCents += line.debitCents;
      current.creditCents += line.creditCents;
      current.closingCents += line.debitCents - line.creditCents;
      current.lines.push({
        order: entry.order,
        number: entry.number,
        day: entry.day,
        concept: line.concept ?? entry.reference,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        balanceCents: current.closingCents,
      });
    }
  }
  return [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export type TrialBalanceRow = { code: string; name: string; debitCents: number; creditCents: number; debtorCents: number; creditorCents: number };
export type TrialBalance = { label: string; /** Último día incluido (AAAA-MM-DD). */ to: string; rows: TrialBalanceRow[]; totals: Omit<TrialBalanceRow, "code" | "name"> };

/**
 * Balance de comprobación de sumas y saldos acumulado hasta `to` (incluido), antes de la
 * regularización y del cierre. Los saldos que vienen de ejercicios anteriores sin asiento de
 * apertura cuentan como suma inicial del debe o del haber.
 */
export function buildTrialBalance(journal: OrderedBookEntry[], prior: AccountBalance[], to: string, label: string): TrialBalance {
  const rows = new Map<string, TrialBalanceRow>();
  const row = (code: string, name: string) => {
    let current = rows.get(code);
    if (!current) rows.set(code, (current = { code, name, debitCents: 0, creditCents: 0, debtorCents: 0, creditorCents: 0 }));
    return current;
  };
  for (const balance of prior) {
    if (balance.balanceCents > 0) row(balance.code, balance.name).debitCents += balance.balanceCents;
    else if (balance.balanceCents < 0) row(balance.code, balance.name).creditCents += -balance.balanceCents;
  }
  for (const entry of journal) {
    if (entry.day > to || entry.kind === "regularization" || entry.kind === "closing") continue;
    for (const line of entry.lines) {
      const current = row(line.accountCode, line.accountName);
      current.debitCents += line.debitCents;
      current.creditCents += line.creditCents;
    }
  }
  const totals = { debitCents: 0, creditCents: 0, debtorCents: 0, creditorCents: 0 };
  const sorted = [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const current of sorted) {
    const net = current.debitCents - current.creditCents;
    current.debtorCents = net > 0 ? net : 0;
    current.creditorCents = net < 0 ? -net : 0;
    totals.debitCents += current.debitCents;
    totals.creditCents += current.creditCents;
    totals.debtorCents += current.debtorCents;
    totals.creditorCents += current.creditorCents;
  }
  return { label, to, rows: sorted, totals };
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** Cortes trimestrales de un ejercicio (cada tres meses desde su inicio; el último acaba con el ejercicio). */
export function quarterCutoffs(year: { startsAt: Date; endsAt: Date }): Array<{ label: string; to: string }> {
  const cutoffs: Array<{ label: string; to: string }> = [];
  const end = dayKey(year.endsAt);
  for (let quarter = 1; quarter <= 8; quarter += 1) {
    const last = new Date(Date.UTC(year.startsAt.getUTCFullYear(), year.startsAt.getUTCMonth() + quarter * 3, year.startsAt.getUTCDate() - 1));
    const to = dayKey(last) >= end ? end : dayKey(last);
    cutoffs.push({ label: `${quarter}.º trimestre`, to });
    if (to === end) break;
  }
  return cutoffs;
}

export function buildQuarterlyTrialBalances(journal: OrderedBookEntry[], prior: AccountBalance[], year: { startsAt: Date; endsAt: Date }): TrialBalance[] {
  return quarterCutoffs(year).map((cutoff) => buildTrialBalance(journal, prior, cutoff.to, cutoff.label));
}

const isProfitAndLoss = (code: string) => code.startsWith("6") || code.startsWith("7");

export type InventoryRow = { code: string; name: string; amountCents: number };
export type Inventory = {
  assets: InventoryRow[];
  equityAndLiabilities: InventoryRow[];
  /** Resultado aún sin regularizar (grupos 6 y 7), beneficio en positivo. 0 si ya se regularizó. */
  pendingResultCents: number;
  totalAssetsCents: number;
  totalEquityAndLiabilitiesCents: number;
};

function inventoryFromBalances(balances: Map<string, { code: string; name: string; cents: number }>): Inventory {
  const assets: InventoryRow[] = [];
  const equityAndLiabilities: InventoryRow[] = [];
  let pendingResultCents = 0;
  for (const balance of [...balances.values()].sort((a, b) => a.code.localeCompare(b.code))) {
    if (balance.cents === 0) continue;
    if (isProfitAndLoss(balance.code)) pendingResultCents += -balance.cents;
    else if (balance.cents > 0) assets.push({ code: balance.code, name: balance.name, amountCents: balance.cents });
    else equityAndLiabilities.push({ code: balance.code, name: balance.name, amountCents: -balance.cents });
  }
  const sum = (rows: InventoryRow[]) => rows.reduce((total, row) => total + row.amountCents, 0);
  return { assets, equityAndLiabilities, pendingResultCents, totalAssetsCents: sum(assets), totalEquityAndLiabilitiesCents: sum(equityAndLiabilities) + pendingResultCents };
}

/**
 * Inventario de cierre: saldo de cada cuenta de balance al final del ejercicio, antes del asiento de
 * cierre (que las deja todas a cero). Con saldo deudor va al activo; con saldo acreedor, al
 * patrimonio neto y pasivo.
 */
export function buildClosingInventory(journal: OrderedBookEntry[], prior: AccountBalance[]): Inventory {
  const balances = new Map<string, { code: string; name: string; cents: number }>();
  const add = (code: string, name: string, cents: number) => {
    const current = balances.get(code) ?? { code, name, cents: 0 };
    current.cents += cents;
    balances.set(code, current);
  };
  for (const balance of prior) add(balance.code, balance.name, balance.balanceCents);
  for (const entry of journal) {
    if (entry.kind === "closing") continue;
    for (const line of entry.lines) add(line.accountCode, line.accountName, line.debitCents - line.creditCents);
  }
  return inventoryFromBalances(balances);
}

/** Balance inicial detallado: el asiento de apertura o, si no lo hay, los saldos que vienen de antes. */
export function buildOpeningInventory(journal: OrderedBookEntry[], prior: AccountBalance[]): Inventory {
  const balances = new Map<string, { code: string; name: string; cents: number }>();
  const add = (code: string, name: string, cents: number) => {
    const current = balances.get(code) ?? { code, name, cents: 0 };
    current.cents += cents;
    balances.set(code, current);
  };
  for (const balance of prior) add(balance.code, balance.name, balance.balanceCents);
  for (const entry of journal) {
    if (entry.kind !== "opening") continue;
    for (const line of entry.lines) add(line.accountCode, line.accountName, line.debitCents - line.creditCents);
  }
  return inventoryFromBalances(balances);
}

export type JournalTotals = { entries: number; lines: number; debitCents: number; creditCents: number };

export function journalTotals(journal: OrderedBookEntry[]): JournalTotals {
  const totals = { entries: journal.length, lines: 0, debitCents: 0, creditCents: 0 };
  for (const entry of journal) {
    for (const line of entry.lines) {
      totals.lines += 1;
      totals.debitCents += line.debitCents;
      totals.creditCents += line.creditCents;
    }
  }
  return totals;
}

/**
 * Huella del contenido contable del ejercicio (SHA-256 en hexadecimal): cambia si se añade, borra o
 * modifica cualquier asiento. Sirve para avisar de que un ejercicio ya legalizado se ha tocado.
 */
export function ledgerFingerprint(journal: OrderedBookEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of journal) {
    hash.update(`${entry.number}|${entry.day}|${entry.kind}\n`);
    for (const line of entry.lines) hash.update(`${line.accountCode}|${line.debitCents}|${line.creditCents}|${line.concept ?? ""}\n`);
  }
  return hash.digest("hex");
}

/** Huella SHA-256 de un fichero, en hexadecimal y en base64 (el formato del anexo I de la Instrucción de 12-02-2015). */
export function fileFingerprint(bytes: Uint8Array) {
  const digest = createHash("sha256").update(bytes).digest();
  return { sha256Hex: digest.toString("hex"), sha256Base64: digest.toString("base64") };
}

/**
 * Asientos cuyo número interno no sigue el orden cronológico del Diario (para avisar): los que
 * habría que renumerar como mínimo, es decir, el total menos la subsecuencia creciente más larga.
 */
export function outOfOrderNumbers(journal: OrderedBookEntry[]): number {
  const numbers = journal.filter((entry) => entry.kind === "normal").map((entry) => entry.number);
  // tails[k]: el menor número final posible de una subsecuencia creciente de longitud k + 1.
  const tails: string[] = [];
  for (const number of numbers) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle].localeCompare(number) < 0) low = middle + 1;
      else high = middle;
    }
    tails[low] = number;
  }
  return numbers.length - tails.length;
}
