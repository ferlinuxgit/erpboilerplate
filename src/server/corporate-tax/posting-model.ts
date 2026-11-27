/**
 * Asiento del Impuesto sobre Sociedades (norma de registro y valoración 13.ª del PGC), función pura.
 *
 * Impuesto corriente:
 *   (6300) Impuesto corriente                      al debe, por la cuota líquida
 *   (473)  HP, retenciones y pagos a cuenta        al haber, por las retenciones y los pagos fraccionados
 *   (4752) HP, acreedora por impuesto sobre sociedades   al haber, si sale a ingresar
 *   (4709) HP, deudora por devolución de impuestos       al debe, si sale a devolver
 *
 * Impuesto diferido, solo si hay diferencias temporarias (valoradas al tipo marginal):
 *   nace una diferencia deducible (ajuste positivo):     (4740) a (6301)
 *   revierte una diferencia deducible (ajuste negativo): (6301) a (4740)
 *   nace una diferencia imponible (ajuste negativo):     (6301) a (479)
 *   revierte una diferencia imponible (ajuste positivo): (479) a (6301)
 *
 * No se registra el crédito fiscal por bases negativas (4745): exige valorar si habrá beneficios
 * futuros para recuperarlo, y eso lo decide la empresa con un asiento manual.
 */

import type { TaxAdjustment } from "@/server/corporate-tax/liquidation";

export const CORPORATE_TAX_ACCOUNTS = {
  currentTax: "6300",
  deferredTax: "6301",
  withholdings: "473",
  payable: "4752",
  refund: "4709",
  deferredAsset: "4740",
  deferredLiability: "479",
} as const;

export type CorporateTaxAccountRole = keyof typeof CORPORATE_TAX_ACCOUNTS;

export type CorporateTaxEntryLine = { role: CorporateTaxAccountRole; debitCents: number; creditCents: number; concept: string };

export type DeferredTax = {
  /** Aumento (+) o disminución (−) del activo por impuesto diferido (4740). */
  assetChangeCents: number;
  /** Aumento (+) o disminución (−) del pasivo por impuesto diferido (479). */
  liabilityChangeCents: number;
  /** Gasto (+) o ingreso (−) por impuesto diferido (6301). */
  expenseCents: number;
};

/** Impuesto diferido de las diferencias temporarias del ejercicio, al tipo indicado. */
export function computeDeferredTax(adjustments: readonly TaxAdjustment[], ratePct: number): DeferredTax {
  let assetBase = 0;
  let liabilityBase = 0;
  for (const item of adjustments) {
    const amount = Math.max(Math.round(item.amountCents), 0);
    if (item.nature === "temporaryOrigin") {
      if (item.sign === "increase") assetBase += amount;
      else liabilityBase += amount;
    } else if (item.nature === "temporaryReversal") {
      if (item.sign === "decrease") assetBase -= amount;
      else liabilityBase -= amount;
    }
  }
  const atRate = (cents: number) => (cents === 0 ? 0 : Math.sign(cents) * Math.round((Math.abs(cents) * ratePct) / 100));
  const assetChangeCents = atRate(assetBase);
  const liabilityChangeCents = atRate(liabilityBase);
  return { assetChangeCents, liabilityChangeCents, expenseCents: liabilityChangeCents - assetChangeCents };
}

export function hasDeferredTax(deferred: DeferredTax | null | undefined) {
  return Boolean(deferred && (deferred.assetChangeCents !== 0 || deferred.liabilityChangeCents !== 0));
}

export function buildCorporateTaxEntryLines(input: {
  netQuotaCents: number;
  withholdingsCents: number;
  installmentsCents: number;
  deferred?: DeferredTax | null;
  yearCode: string;
}): CorporateTaxEntryLine[] {
  const lines: CorporateTaxEntryLine[] = [];
  const label = `Impuesto sobre Sociedades ${input.yearCode}`;
  const debit = (role: CorporateTaxAccountRole, cents: number, concept: string) => {
    if (cents > 0) lines.push({ role, debitCents: cents, creditCents: 0, concept });
  };
  const credit = (role: CorporateTaxAccountRole, cents: number, concept: string) => {
    if (cents > 0) lines.push({ role, debitCents: 0, creditCents: cents, concept });
  };

  const paidOnAccount = input.withholdingsCents + input.installmentsCents;
  const differential = input.netQuotaCents - paidOnAccount;
  debit("currentTax", input.netQuotaCents, `${label} · impuesto corriente`);
  debit("refund", -differential, `${label} · a devolver`);
  credit("withholdings", paidOnAccount, `${label} · retenciones y pagos a cuenta`);
  credit("payable", differential, `${label} · a ingresar`);

  const deferred = input.deferred;
  if (deferred) {
    debit("deferredAsset", deferred.assetChangeCents, `${label} · activo por impuesto diferido`);
    credit("deferredAsset", -deferred.assetChangeCents, `${label} · reversión del activo por impuesto diferido`);
    debit("deferredLiability", -deferred.liabilityChangeCents, `${label} · reversión del pasivo por impuesto diferido`);
    credit("deferredLiability", deferred.liabilityChangeCents, `${label} · pasivo por impuesto diferido`);
    debit("deferredTax", deferred.expenseCents, `${label} · impuesto diferido`);
    credit("deferredTax", -deferred.expenseCents, `${label} · impuesto diferido`);
  }
  return lines;
}

/** Totales del asiento (para comprobar el cuadre y comparar con lo ya contabilizado). */
export function entryTotals(lines: readonly CorporateTaxEntryLine[]) {
  return {
    debitCents: lines.reduce((sum, line) => sum + line.debitCents, 0),
    creditCents: lines.reduce((sum, line) => sum + line.creditCents, 0),
  };
}
