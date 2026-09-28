import { formatAmount } from "@/lib/format";
import type { ChartNature } from "@/lib/chart-of-accounts/types";

/** Presentación de los importes y códigos del plan contable (funciones puras). */

export function formatCents(cents: number) {
  return formatAmount(cents / 100);
}

/** «D» deudor, «A» acreedor o null si está saldada. */
export function balanceSideLetter(cents: number): "D" | "A" | null {
  if (cents === 0) return null;
  return cents > 0 ? "D" : "A";
}

export function balanceSideWord(cents: number) {
  if (cents === 0) return "saldada";
  return cents > 0 ? "deudor" : "acreedor";
}

/** Saldo contrario a la naturaleza de la cuenta (p. ej. clientes con saldo acreedor). */
export function contradictsNature(cents: number, nature: ChartNature) {
  return (nature === "DEBIT" && cents < 0) || (nature === "CREDIT" && cents > 0);
}

export const NATURE_LABELS: Record<ChartNature, string> = {
  DEBIT: "Deudora",
  CREDIT: "Acreedora",
  MIXED: "Mixta",
};

/** Código segmentado: la parte heredada del padre (atenuada) y la propia (en negrita): 4300|0001. */
export function splitCode(code: string, parentCode: string | null) {
  if (parentCode && code.startsWith(parentCode) && parentCode.length < code.length) {
    return { inherited: parentCode, own: code.slice(parentCode.length) };
  }
  return { inherited: "", own: code };
}

/** Color del grupo del PGC: tokens --chart-1..5 en ciclo (el dígito del grupo siempre va en texto). */
export function groupAccentVar(code: string) {
  const digit = Number(code.charAt(0));
  const index = Number.isInteger(digit) && digit > 0 ? ((digit - 1) % 5) + 1 : 1;
  return `var(--chart-${index})`;
}

export function ledgerHref(accountId: string, range: { from: string; to: string } | null) {
  return range ? `/accounting/ledger/${accountId}?from=${range.from}&to=${range.to}` : `/accounting/ledger/${accountId}`;
}
