const JOURNAL_ENTRY_NUMBER_PREFIX = "AS";
const JOURNAL_ENTRY_NUMBER_WIDTH = 6;

/** Numeración antigua, global por empresa (AS000001). Solo para asientos sin ejercicio. */
export function formatJournalEntryNumber(sequence: number) {
  const normalizedSequence = Math.max(1, Math.trunc(sequence));
  return `${JOURNAL_ENTRY_NUMBER_PREFIX}${String(normalizedSequence).padStart(JOURNAL_ENTRY_NUMBER_WIDTH, "0")}`;
}

/**
 * Numeración por ejercicio: `AS-<código del ejercicio>/000001` (p. ej. AS-2026/000001), se reinicia
 * en cada ejercicio. Incluye el código del ejercicio para que el número siga siendo único por empresa.
 */
export function formatFiscalYearJournalEntryNumber(fiscalYearCode: string, sequence: number) {
  const normalizedSequence = Math.max(1, Math.trunc(sequence));
  return `${JOURNAL_ENTRY_NUMBER_PREFIX}-${fiscalYearCode}/${String(normalizedSequence).padStart(JOURNAL_ENTRY_NUMBER_WIDTH, "0")}`;
}
