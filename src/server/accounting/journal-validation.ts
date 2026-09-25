import { AccountingRuleError } from "@/server/accounting/errors";

class JournalValidationError extends AccountingRuleError {
  constructor(message: string) {
    super(422, "JOURNAL_INVALID", message);
    this.name = "JournalValidationError";
  }
}

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
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) throw new JournalValidationError("Importe inválido.");
  const amount = Number(raw);
  if (!Number.isFinite(amount)) throw new JournalValidationError("Importe inválido.");
  if (amount < 0) throw new JournalValidationError("El importe no puede ser negativo.");
  return Math.round(amount * 100);
}

function centsToDecimal(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function centsToString(cents: number) {
  return (cents / 100).toFixed(2);
}

export function validateJournalLines(lines: JournalLineInput[]): JournalLineValidationResult {
  if (lines.length < 2) throw new JournalValidationError("El asiento debe tener al menos dos líneas.");

  let totalDebitCents = 0;
  let totalCreditCents = 0;

  const normalized = lines.map((line) => {
    const accountId = line.accountId?.trim() ?? "";
    if (!accountId) throw new JournalValidationError("Cuenta contable requerida.");

    const debitCents = parseMoneyToCents(line.debit);
    const creditCents = parseMoneyToCents(line.credit);
    if (debitCents === 0 && creditCents === 0) throw new JournalValidationError("Debe indicar un importe en cada línea.");
    if (debitCents > 0 && creditCents > 0) throw new JournalValidationError("Una línea solo puede tener debe o haber.");

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
    throw new JournalValidationError("El asiento está descuadrado: el total del debe tiene que ser igual al del haber.");
  }

  return {
    lines: normalized,
    totalDebit: centsToDecimal(totalDebitCents),
    totalCredit: centsToDecimal(totalCreditCents),
    difference: centsToDecimal(differenceCents),
  };
}
