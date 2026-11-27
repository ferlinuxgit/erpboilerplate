import { formatFiscalYearJournalEntryNumber } from "@/lib/journal-entry-number";
import { bookEntryKind, orderJournal } from "@/server/accounting/books/books-model";
import { accountingDay } from "@/server/accounting/fiscal-year-date";

/**
 * RENUMERACIÓN DE ASIENTOS POR FECHA (función pura).
 *
 * El número de un asiento (AS-2026/000123) se asigna al crearlo, así que un asiento registrado
 * tarde con fecha anterior queda con un número mayor que otros posteriores. El art. 28.2 del Código
 * de Comercio pide que el Diario registre «día a día» las operaciones: el Libro Diario ya sale en
 * orden cronológico con su número de orden, y esta renumeración hace que el número interno siga ese
 * mismo orden.
 *
 * El orden es exactamente el del Libro Diario (`orderJournal`): día contable en la hora local de la
 * empresa; dentro del día, apertura primero y regularización y cierre al final; después la hora y,
 * por último, el número actual (para que el resultado sea estable). Como la apertura se fecha el
 * primer día del ejercicio y la regularización y el cierre el último, la apertura queda la primera y
 * el cierre el último.
 */

export type RenumberEntry = {
  id: string;
  number: string;
  postedAt: Date;
  sourceType: string | null;
  reference: string | null;
};

export type RenumberChange = { id: string; day: string; reference: string | null; from: string; to: string };

export type RenumberPlan = {
  /** Asientos del ejercicio. */
  total: number;
  /** Asientos cuyo número cambia, en el orden nuevo. */
  changes: RenumberChange[];
  /** Siguiente número libre del ejercicio tras renumerar. */
  nextNumber: number;
};

const DAY_MS = 86_400_000;

export function planEntryRenumbering(entries: readonly RenumberEntry[], yearCode: string, timeZone: string): RenumberPlan {
  const ordered = orderJournal(entries.map((entry) => {
    const kind = bookEntryKind(entry.sourceType);
    // Igual que el Libro Diario: los asientos del ciclo se fechan por su día civil; el resto, en hora local.
    const day = (kind === "normal" ? accountingDay(entry.postedAt, timeZone) : new Date(Math.floor(entry.postedAt.getTime() / DAY_MS) * DAY_MS)).toISOString().slice(0, 10);
    return { id: entry.id, number: entry.number, postedAt: entry.postedAt, day, reference: entry.reference, kind, lines: [] };
  }));
  const changes: RenumberChange[] = [];
  for (const entry of ordered) {
    const to = formatFiscalYearJournalEntryNumber(yearCode, entry.order);
    if (to !== entry.number) changes.push({ id: entry.id, day: entry.day, reference: entry.reference, from: entry.number, to });
  }
  return { total: ordered.length, changes, nextNumber: ordered.length + 1 };
}
