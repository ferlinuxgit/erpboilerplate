import { formatAmount, parseDecimalInput } from "@/lib/format";

export type JournalFormLine = {
  accountId: string;
  /** Texto tal como lo escribe el usuario ("1.234,56" o "1234.56"). */
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

/** Importe en céntimos; NaN si no es un importe válido (negativo o con más de 2 decimales). */
function parseMoneyToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string" && value.trim() === "") return 0;
  const amount = parseDecimalInput(value, { maximumFractionDigits: 2 });
  if (amount === null || amount < 0) return Number.NaN;
  const cents = amount * 100;
  if (Math.abs(cents - Math.round(cents)) > 1e-6) return Number.NaN;
  return Math.round(cents);
}

function centsToDecimal(cents: number) {
  return Number((cents / 100).toFixed(2));
}

export function emptyJournalLine(): JournalFormLine {
  // Sin cuenta por defecto: el usuario la elige siempre (nunca se asigna una en silencio).
  return { accountId: "", debit: "", credit: "" };
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
  return describeJournalEntryBlockers(payload).length === 0;
}

/**
 * Motivos (en español) por los que el asiento todavía no se puede guardar. Se muestran junto al
 * botón para que el usuario sepa qué le falta, en vez de un botón desactivado sin explicación.
 */
export function describeJournalEntryBlockers(payload: SubmitPayload): string[] {
  const reasons: string[] = [];
  if (!payload.postedAt) reasons.push("Indica la fecha del asiento.");
  if (payload.lines.length < 2) reasons.push("El asiento necesita al menos dos líneas.");
  payload.lines.forEach((line, index) => {
    const debit = parseMoneyToCents(line.debit);
    const credit = parseMoneyToCents(line.credit);
    const label = `Línea ${index + 1}`;
    if (Number.isNaN(debit) || Number.isNaN(credit)) reasons.push(`${label}: el importe no es válido (usa por ejemplo 1.234,56).`);
    else if (debit === 0 && credit === 0) reasons.push(`${label}: escribe un importe en el debe o en el haber.`);
    if (!line.accountId.trim()) reasons.push(`${label}: elige la cuenta.`);
  });
  const totals = calculateJournalTotals(payload.lines);
  const invalid = reasons.some((reason) => reason.includes("importe"));
  if (!invalid && Math.abs(totals.difference) >= 0.005) {
    reasons.push(
      totals.difference > 0
        ? `Descuadre de ${formatAmount(totals.difference)} €: el debe supera al haber. Añade ${formatAmount(totals.difference)} € al haber.`
        : `Descuadre de ${formatAmount(-totals.difference)} €: el haber supera al debe. Añade ${formatAmount(-totals.difference)} € al debe.`,
    );
  }
  return reasons;
}

export function updateJournalLineAmount(line: JournalFormLine, side: "debit" | "credit", value: string): JournalFormLine {
  if (side === "debit") return { ...line, debit: value, credit: value ? "" : line.credit };
  return { ...line, debit: value ? "" : line.debit, credit: value };
}

/** Líneas listas para la API: importes normalizados "1234.56" (el servidor no entiende "1.234,56"). */
export function normalizeJournalLinesForSubmit(lines: JournalFormLine[]) {
  const normalize = (value: string) => {
    const cents = parseMoneyToCents(value);
    return !cents || Number.isNaN(cents) ? "" : (cents / 100).toFixed(2);
  };
  return lines.map((line) => ({ accountId: line.accountId, debit: normalize(line.debit), credit: normalize(line.credit) }));
}
