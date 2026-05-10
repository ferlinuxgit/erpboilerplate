export type JournalLineInput = {
  accountId?: string | null;
  debit?: string | number | null;
  credit?: string | number | null;
};

export type NormalizedJournalLine = {
  accountId: string;
  debit: string;
  credit: string;
};

export type JournalLineValidationResult = {
  lines: NormalizedJournalLine[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
};

function parseMoneyToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const raw = typeof value === "number" ? String(value) : value.trim().replace(",", ".");
  if (raw === "") return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Importe invalido.");
  const amount = Number(raw);
  if (!Number.isFinite(amount)) throw new Error("Importe invalido.");
  if (amount < 0) throw new Error("El importe no puede ser negativo.");
  return Math.round(amount * 100);
}

function centsToDecimal(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function centsToString(cents: number) {
  return (cents / 100).toFixed(2);
}

export function validateJournalLines(lines: JournalLineInput[]): JournalLineValidationResult {
  if (lines.length < 2) throw new Error("El asiento debe tener al menos dos lineas.");

  let totalDebitCents = 0;
  let totalCreditCents = 0;

  const normalized = lines.map((line) => {
    const accountId = line.accountId?.trim() ?? "";
    if (!accountId) throw new Error("Cuenta contable requerida.");

    const debitCents = parseMoneyToCents(line.debit);
    const creditCents = parseMoneyToCents(line.credit);
    if (debitCents === 0 && creditCents === 0) throw new Error("Debe indicar un importe en cada linea.");
    if (debitCents > 0 && creditCents > 0) throw new Error("Una linea solo puede tener debe o haber.");

    totalDebitCents += debitCents;
    totalCreditCents += creditCents;

    return {
      accountId,
      debit: centsToString(debitCents),
      credit: centsToString(creditCents),
    };
  });

  const differenceCents = totalDebitCents - totalCreditCents;
  if (totalDebitCents <= 0 || totalCreditCents <= 0 || differenceCents !== 0) {
    throw new Error("El asiento debe estar balanceado (debe = haber).");
  }

  return {
    lines: normalized,
    totalDebit: centsToDecimal(totalDebitCents),
    totalCredit: centsToDecimal(totalCreditCents),
    difference: centsToDecimal(differenceCents),
  };
}
