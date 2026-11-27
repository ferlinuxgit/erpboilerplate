/**
 * Liquidación del Impuesto sobre Sociedades (Ley 27/2014), función pura en céntimos:
 *
 *   resultado contable antes de impuestos
 *   ± ajustes extracontables (art. 10.3: correcciones al resultado contable)
 *   = base imponible previa
 *   − reserva de capitalización (art. 25)
 *   − compensación de bases imponibles negativas (art. 26: 70 % de la base previa, mínimo 1 millón)
 *   = base imponible
 *   ± reserva de nivelación (art. 105)
 *   × tipo de gravamen (art. 29 y disposición transitoria 44.ª) = cuota íntegra (art. 30.1)
 *   − bonificaciones y deducciones = cuota líquida, nunca negativa (art. 30.2)
 *   − retenciones, ingresos a cuenta y pagos fraccionados (art. 41)
 *   = cuota diferencial (a ingresar o a devolver)
 *
 * Fuera de alcance, con aviso: límites de las grandes empresas (disposición adicional 15.ª, cifra
 * de negocios desde 20 millones), tributación mínima (art. 30 bis), grupos fiscales, regímenes
 * especiales y cooperativas. No se numeran casillas del modelo 200: no se han contrastado.
 */

import { applyRateSchedule, corporateTaxRateSchedule, prorateByDays, type BracketQuota, type CorporateTaxRegime, type RateSchedule } from "@/server/corporate-tax/rates";

/** increase: suma al resultado contable (gasto no deducible…); decrease: resta (ingreso exento…). */
export type AdjustmentSign = "increase" | "decrease";

/**
 * permanent: diferencia permanente (no vuelve). temporaryOrigin: nace una diferencia temporaria
 * (revertirá en ejercicios futuros). temporaryReversal: revierte una nacida en ejercicios anteriores.
 * Solo las temporarias generan impuesto diferido (6301 con 4740 o 479).
 */
export type AdjustmentNature = "permanent" | "temporaryOrigin" | "temporaryReversal";

export type TaxAdjustment = {
  id: string;
  /** Clave del catálogo de ajustes habituales, u "other". */
  kind: string;
  concept: string;
  sign: AdjustmentSign;
  amountCents: number;
  nature: AdjustmentNature;
};

export type TaxCredit = { id: string; concept: string; amountCents: number };

/** Base imponible negativa pendiente de compensar, por ejercicio de origen. */
export type LossCarryforward = { originYear: number; pendingCents: number };

export type CorporateTaxInput = {
  /** Resultado de la cuenta de pérdidas y ganancias sin el gasto por impuesto (6300, 6301, 633, 638). */
  accountingResultBeforeTaxCents: number;
  adjustments: readonly TaxAdjustment[];
  /** Reducción por reserva de capitalización que quiere aplicar el usuario (art. 25). */
  capitalizationReserveCents: number;
  /** Bases negativas de ejercicios anteriores pendientes (art. 26). */
  losses: readonly LossCarryforward[];
  /** Importe que se quiere compensar; null = el máximo que permita la ley. */
  lossCompensationCents: number | null;
  /** Minoración por reserva de nivelación que quiere aplicar el usuario (art. 105.1). */
  levelingReductionCents: number;
  /** Adición de minoraciones de ejercicios anteriores (art. 105.2). */
  levelingAdditionCents: number;
  regime: CorporateTaxRegime;
  customRatePct?: number | null;
  /** Año natural en que se inicia el periodo impositivo y días que dura. */
  startYear: number;
  periodDays?: number | null;
  /** Bonificaciones y deducciones de la cuota, con su concepto. */
  credits: readonly TaxCredit[];
  /** Retenciones e ingresos a cuenta soportados (saldo de la 473). */
  withholdingsCents: number;
  /** Pagos fraccionados del ejercicio (modelos 202). */
  installmentsCents: number;
};

export type CorporateTaxWarning = { code: string; message: string };

export type CorporateTaxResult = {
  accountingResultBeforeTaxCents: number;
  increasesCents: number;
  decreasesCents: number;
  /** Base imponible previa a la reserva de capitalización y a la compensación de bases negativas. */
  priorBaseCents: number;
  capitalizationReserve: { requestedCents: number; limitCents: number; appliedCents: number };
  losses: {
    availableCents: number;
    /** Máximo compensable este ejercicio (el mayor entre el 70 % de la base previa y 1 millón, sin pasar de la base). */
    limitCents: number;
    appliedCents: number;
    applied: Array<{ originYear: number; amountCents: number }>;
    /** Lo que queda pendiente de cada ejercicio de origen tras esta liquidación. */
    remaining: LossCarryforward[];
  };
  taxableBaseCents: number;
  leveling: { reductionRequestedCents: number; reductionLimitCents: number; reductionAppliedCents: number; additionCents: number };
  /** Base sobre la que se aplica el tipo (base imponible tras la reserva de nivelación). */
  rateBaseCents: number;
  schedule: RateSchedule;
  brackets: BracketQuota[];
  grossQuotaCents: number;
  creditsRequestedCents: number;
  creditsAppliedCents: number;
  netQuotaCents: number;
  withholdingsCents: number;
  installmentsCents: number;
  /** Positiva: a ingresar. Negativa: a devolver. */
  differentialCents: number;
  outcome: "toPay" | "toRefund" | "zero";
  /** Base imponible negativa que nace este ejercicio y queda para compensar en los siguientes. */
  generatedLossCents: number;
  /** Tipo marginal (el del último tramo que alcanza la base): el que se usa para valorar el impuesto diferido. */
  marginalRatePct: number;
  warnings: CorporateTaxWarning[];
};

/** Límite del 70 % de la base previa (art. 26.1) y mínimo de 1 millón (prorrateado si el periodo es inferior al año, art. 26.2). */
export const LOSS_LIMIT_PCT = 70;
export const LOSS_MINIMUM_CENTS = 1_000_000_00;
/** Reserva de nivelación: hasta el 10 % de la base imponible positiva, con tope de 1 millón (art. 105.1). */
export const LEVELING_LIMIT_PCT = 10;
export const LEVELING_MAXIMUM_CENTS = 1_000_000_00;

const nonNegative = (cents: number | null | undefined) => (Number.isFinite(cents) ? Math.max(Math.round(Number(cents)), 0) : 0);

/**
 * Tope de la reducción por reserva de capitalización sobre la base imponible positiva previa
 * (art. 25.1, redacción vigente para periodos iniciados desde 2025, contrastada con el BOE el
 * 27-11-2026): 20 %, o 25 % si la cifra de negocios es inferior a 1 millón. Para periodos
 * anteriores se usa el 10 % de la redacción original (no contrastado ese día).
 */
export function capitalizationLimitPct(startYear: number, regime: CorporateTaxRegime) {
  if (startYear < 2025) return 10;
  return regime === "micro" ? 25 : 20;
}

/** Reparte la compensación entre los ejercicios de origen, empezando por el más antiguo. */
export function allocateLosses(losses: readonly LossCarryforward[], amountCents: number) {
  const ordered = [...losses].filter((loss) => loss.pendingCents > 0).sort((a, b) => a.originYear - b.originYear);
  let remainingToApply = Math.max(amountCents, 0);
  const applied: Array<{ originYear: number; amountCents: number }> = [];
  const remaining: LossCarryforward[] = [];
  for (const loss of ordered) {
    const used = Math.min(loss.pendingCents, remainingToApply);
    remainingToApply -= used;
    if (used > 0) applied.push({ originYear: loss.originYear, amountCents: used });
    if (loss.pendingCents - used > 0) remaining.push({ originYear: loss.originYear, pendingCents: loss.pendingCents - used });
  }
  return { applied, remaining };
}

export function computeCorporateTax(input: CorporateTaxInput): CorporateTaxResult {
  const warnings: CorporateTaxWarning[] = [];
  const accountingResult = Math.round(input.accountingResultBeforeTaxCents);
  const increasesCents = input.adjustments.filter((item) => item.sign === "increase").reduce((sum, item) => sum + nonNegative(item.amountCents), 0);
  const decreasesCents = input.adjustments.filter((item) => item.sign === "decrease").reduce((sum, item) => sum + nonNegative(item.amountCents), 0);
  const priorBaseCents = accountingResult + increasesCents - decreasesCents;
  const positivePriorBase = Math.max(priorBaseCents, 0);

  // Reserva de capitalización: con tope sobre la base previa positiva.
  const capitalizationRequested = nonNegative(input.capitalizationReserveCents);
  const capitalizationLimit = Math.round((positivePriorBase * capitalizationLimitPct(input.startYear, input.regime)) / 100);
  const capitalizationApplied = Math.min(capitalizationRequested, capitalizationLimit);
  if (capitalizationRequested > capitalizationApplied) {
    warnings.push({
      code: "capitalization-limited",
      message: "La reducción por reserva de capitalización supera el tope sobre la base imponible previa (art. 25.1). Se aplica solo hasta el tope; el resto puede aplicarse en los dos ejercicios siguientes.",
    });
  }
  const afterCapitalization = priorBaseCents - capitalizationApplied;

  // Bases negativas: el mayor entre el 70 % de la base previa y 1 millón, sin dejar la base por debajo de cero.
  const availableCents = input.losses.reduce((sum, loss) => sum + nonNegative(loss.pendingCents), 0);
  // Las entidades de nueva creación no tienen el límite del 70 % en sus tres primeros periodos con base positiva (art. 26.3).
  const legalLimit = input.regime === "newCompany"
    ? Number.MAX_SAFE_INTEGER
    : Math.max(Math.round((positivePriorBase * LOSS_LIMIT_PCT) / 100), prorateByDays(LOSS_MINIMUM_CENTS, input.periodDays));
  const lossLimitCents = Math.min(Math.max(afterCapitalization, 0), legalLimit);
  const lossRequested = input.lossCompensationCents === null ? Number.MAX_SAFE_INTEGER : nonNegative(input.lossCompensationCents);
  const lossAppliedCents = Math.min(lossRequested, availableCents, lossLimitCents);
  if (input.lossCompensationCents !== null && lossRequested > lossAppliedCents) {
    warnings.push({
      code: "losses-limited",
      message: lossRequested > availableCents
        ? "Quieres compensar más bases negativas de las que hay pendientes. Se compensa solo lo pendiente."
        : "La compensación de bases negativas supera el límite del ejercicio (70 % de la base previa, con un mínimo de 1 millón, art. 26.1). Se aplica solo hasta el límite.",
    });
  }
  const allocation = allocateLosses(input.losses, lossAppliedCents);
  const taxableBaseCents = afterCapitalization - lossAppliedCents;

  // Reserva de nivelación: minora la base positiva (hasta el 10 %, máximo 1 millón) o la aumenta.
  const levelingRequested = nonNegative(input.levelingReductionCents);
  const levelingLimit = Math.min(
    Math.round((Math.max(taxableBaseCents, 0) * LEVELING_LIMIT_PCT) / 100),
    prorateByDays(LEVELING_MAXIMUM_CENTS, input.periodDays),
  );
  const levelingApplied = Math.min(levelingRequested, levelingLimit);
  if (levelingRequested > levelingApplied) {
    warnings.push({ code: "leveling-limited", message: "La minoración por reserva de nivelación supera el 10 % de la base imponible positiva o el tope de 1 millón (art. 105.1). Se aplica solo hasta el límite." });
  }
  if (levelingRequested > 0 && input.regime !== "micro" && input.regime !== "reduced") {
    warnings.push({ code: "leveling-regime", message: "La reserva de nivelación es un incentivo de las entidades de reducida dimensión (art. 105). Comprueba que la sociedad cumple el art. 101 antes de aplicarla." });
  }
  const levelingAddition = nonNegative(input.levelingAdditionCents);
  const rateBaseCents = taxableBaseCents - levelingApplied + levelingAddition;

  const schedule = corporateTaxRateSchedule({ regime: input.regime, startYear: input.startYear, periodDays: input.periodDays, customRatePct: input.customRatePct });
  const brackets = applyRateSchedule(rateBaseCents, schedule.brackets);
  const grossQuotaCents = brackets.reduce((sum, bracket) => sum + bracket.quotaCents, 0);

  const creditsRequestedCents = input.credits.reduce((sum, credit) => sum + nonNegative(credit.amountCents), 0);
  const creditsAppliedCents = Math.min(creditsRequestedCents, grossQuotaCents);
  if (creditsRequestedCents > creditsAppliedCents) {
    warnings.push({ code: "credits-limited", message: "Las bonificaciones y deducciones superan la cuota íntegra: la cuota líquida no puede ser negativa (art. 30.2). Lo que no cabe queda, en su caso, pendiente para ejercicios futuros según cada deducción." });
  }
  const netQuotaCents = grossQuotaCents - creditsAppliedCents;

  const withholdingsCents = nonNegative(input.withholdingsCents);
  const installmentsCents = nonNegative(input.installmentsCents);
  const differentialCents = netQuotaCents - withholdingsCents - installmentsCents;

  return {
    accountingResultBeforeTaxCents: accountingResult,
    increasesCents,
    decreasesCents,
    priorBaseCents,
    capitalizationReserve: { requestedCents: capitalizationRequested, limitCents: capitalizationLimit, appliedCents: capitalizationApplied },
    losses: { availableCents, limitCents: lossLimitCents, appliedCents: lossAppliedCents, applied: allocation.applied, remaining: allocation.remaining },
    taxableBaseCents,
    leveling: { reductionRequestedCents: levelingRequested, reductionLimitCents: levelingLimit, reductionAppliedCents: levelingApplied, additionCents: levelingAddition },
    rateBaseCents,
    schedule,
    brackets,
    grossQuotaCents,
    creditsRequestedCents,
    creditsAppliedCents,
    netQuotaCents,
    withholdingsCents,
    installmentsCents,
    differentialCents,
    outcome: differentialCents > 0 ? "toPay" : differentialCents < 0 ? "toRefund" : "zero",
    generatedLossCents: rateBaseCents < 0 ? -rateBaseCents : 0,
    marginalRatePct: brackets[brackets.length - 1]?.pct ?? schedule.brackets[0]?.pct ?? 0,
    warnings,
  };
}
