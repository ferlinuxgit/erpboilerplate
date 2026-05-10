export type JournalFormLine = {
  accountId: string;
  debit: string;
  credit: string;
};

export type JournalTotals = {
  totalDebit: number;
  totalCredit: number;
  difference: number;
  isBalanced: boolean;
};

type SubmitPayload = {
  postedAt: string;
  lines: JournalFormLine[];
};

function parseMoneyToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const raw = typeof value === "number" ? String(value) : value.trim().replace(",", ".");
  if (raw === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return Number.NaN;
  return Math.round(Number(raw) * 100);
}

function centsToDecimal(cents: number) {
  return Number((cents / 100).toFixed(2));
}

export function calculateJournalTotals(lines: JournalFormLine[]): JournalTotals {
  let debitCents = 0;
  let creditCents = 0;
  let hasInvalidAmount = false;

  for (const line of lines) {
    const debit = parseMoneyToCents(line.debit);
    const credit = parseMoneyToCents(line.credit);
    if (Number.isNaN(debit) || Number.isNaN(credit)) {
      hasInvalidAmount = true;
      continue;
    }
    debitCents += debit;
    creditCents += credit;
  }

  const differenceCents = debitCents - creditCents;
  return {
    totalDebit: centsToDecimal(debitCents),
    totalCredit: centsToDecimal(creditCents),
    difference: centsToDecimal(differenceCents),
    isBalanced: !hasInvalidAmount && debitCents > 0 && creditCents > 0 && differenceCents === 0,
  };
}

export function hasValidJournalLine(line: JournalFormLine) {
  const debit = parseMoneyToCents(line.debit);
  const credit = parseMoneyToCents(line.credit);
  return Boolean(
    line.accountId.trim() &&
      !Number.isNaN(debit) &&
      !Number.isNaN(credit) &&
      ((debit > 0 && credit === 0) || (credit > 0 && debit === 0)),
  );
}

export function canSubmitJournalEntry(payload: SubmitPayload) {
  return Boolean(
    payload.postedAt &&
      payload.lines.length >= 2 &&
      payload.lines.every(hasValidJournalLine) &&
      calculateJournalTotals(payload.lines).isBalanced,
  );
}

export function updateJournalLineAmount(line: JournalFormLine, side: "debit" | "credit", value: string): JournalFormLine {
  if (side === "debit") return { ...line, debit: value, credit: value ? "" : line.credit };
  return { ...line, debit: value ? "" : line.debit, credit: value };
}
