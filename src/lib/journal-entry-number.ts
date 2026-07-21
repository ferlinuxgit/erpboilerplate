const JOURNAL_ENTRY_NUMBER_PREFIX = "AS";
const JOURNAL_ENTRY_NUMBER_WIDTH = 6;

export function formatJournalEntryNumber(sequence: number) {
  const normalizedSequence = Math.max(1, Math.trunc(sequence));
  return `${JOURNAL_ENTRY_NUMBER_PREFIX}${String(normalizedSequence).padStart(JOURNAL_ENTRY_NUMBER_WIDTH, "0")}`;
}
