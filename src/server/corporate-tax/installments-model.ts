/**
 * Pagos fraccionados del Impuesto sobre Sociedades (modelo 202; art. 40 y disposición adicional
 * 14.ª de la Ley 27/2014), función pura en céntimos.
 *
 * CONTRASTADO el 27-11-2026 con el texto consolidado del BOE y con las instrucciones del modelo 202
 * «para 2025 y siguientes» de la sede de la AEAT:
 *
 * - Modalidad del art. 40.2: 18 % de la cuota íntegra del último periodo cuyo plazo de declaración
 *   estuviera vencido el día 1 de abril, octubre o diciembre, minorada en deducciones,
 *   bonificaciones y retenciones e ingresos a cuenta. Casilla [01] base y [03] a ingresar.
 * - Modalidad del art. 40.3: sobre la base imponible de los 3, 9 u 11 primeros meses del año
 *   natural; porcentaje = 5/7 del tipo de gravamen redondeado por defecto. De la cuota se restan
 *   las bonificaciones [27], las retenciones e ingresos a cuenta [28] y los pagos fraccionados
 *   anteriores del periodo [30]. Obligatoria si la cifra de negocios de los 12 meses anteriores
 *   superó 6 millones.
 * - Cifra de negocios desde 10 millones (D.A. 14.ª): porcentaje = 19/20 del tipo redondeado por
 *   exceso, y mínimo a ingresar [33] del 23 % del resultado positivo de la cuenta de pérdidas y
 *   ganancias del periodo, minorado solo en los pagos fraccionados anteriores.
 *
 * NO CONTRASTADO: cómo se aplica la escala de microempresas en la modalidad del art. 40.3. Aquí
 * se aplica el 5/7 a cada tramo (las instrucciones prevén «más de un porcentaje», casillas [19] a
 * [26]), con el tramo de 50.000 € entero. Se avisa en pantalla.
 */

import { allocateLosses, LOSS_LIMIT_PCT, LOSS_MINIMUM_CENTS, type LossCarryforward } from "@/server/corporate-tax/liquidation";
import { applyRateSchedule, corporateTaxRateSchedule, type BracketQuota, type CorporateTaxRegime } from "@/server/corporate-tax/rates";

export type InstallmentPeriod = "1P" | "2P" | "3P";
export type InstallmentMethod = "quota" | "base";

export const INSTALLMENT_PERIODS: ReadonlyArray<{ period: InstallmentPeriod; label: string; dueMonth: number; monthsCovered: number }> = [
  { period: "1P", label: "1P · abril", dueMonth: 4, monthsCovered: 3 },
  { period: "2P", label: "2P · octubre", dueMonth: 10, monthsCovered: 9 },
  { period: "3P", label: "3P · diciembre", dueMonth: 12, monthsCovered: 11 },
];

export const INSTALLMENT_METHOD_LABELS: Record<InstallmentMethod, string> = {
  quota: "Sobre la cuota del último ejercicio (art. 40.2)",
  base: "Sobre la base imponible del año en curso (art. 40.3)",
};

export function isInstallmentPeriod(value: unknown): value is InstallmentPeriod {
  return value === "1P" || value === "2P" || value === "3P";
}

export function installmentPeriodInfo(period: InstallmentPeriod) {
  return INSTALLMENT_PERIODS.find((entry) => entry.period === period) ?? INSTALLMENT_PERIODS[0];
}

/** Umbrales de cifra de negocios de los 12 meses anteriores al inicio del periodo impositivo. */
export const BASE_METHOD_MANDATORY_REVENUE_CENTS = 6_000_000_00;
export const LARGE_COMPANY_REVENUE_CENTS = 10_000_000_00;
export const QUOTA_METHOD_PCT = 18;
export const LARGE_COMPANY_MINIMUM_PCT = 23;

/** La modalidad del art. 40.3 es obligatoria si la cifra de negocios superó 6 millones. */
export function baseMethodMandatory(revenueCents: number | null | undefined) {
  return (revenueCents ?? 0) > BASE_METHOD_MANDATORY_REVENUE_CENTS;
}

export function isLargeCompany(revenueCents: number | null | undefined) {
  return (revenueCents ?? 0) >= LARGE_COMPANY_REVENUE_CENTS;
}

/** Porcentaje del art. 40.3 para un tipo de gravamen: 5/7 por defecto, o 19/20 por exceso (D.A. 14.ª). */
export function baseMethodPct(ratePct: number, largeCompany = false) {
  if (largeCompany) return Math.ceil((ratePct * 19) / 20 - 1e-9);
  return Math.floor((ratePct * 5) / 7 + 1e-9);
}

export type QuotaInstallmentInput = {
  /** Cuota íntegra del último ejercicio con el plazo de declaración vencido. */
  grossQuotaCents: number;
  /** Deducciones y bonificaciones de aquel ejercicio. */
  creditsCents: number;
  /** Retenciones e ingresos a cuenta de aquel ejercicio. */
  withholdingsCents: number;
};

export type QuotaInstallmentResult = { method: "quota"; baseCents: number; pct: number; amountCents: number };

export function computeQuotaInstallment(input: QuotaInstallmentInput): QuotaInstallmentResult {
  const baseCents = Math.max(Math.round(input.grossQuotaCents) - Math.max(Math.round(input.creditsCents), 0) - Math.max(Math.round(input.withholdingsCents), 0), 0);
  return { method: "quota", baseCents, pct: QUOTA_METHOD_PCT, amountCents: Math.round((baseCents * QUOTA_METHOD_PCT) / 100) };
}

export type BaseInstallmentInput = {
  /** Resultado contable antes de impuestos de los 3, 9 u 11 primeros meses. */
  accountingResultBeforeTaxCents: number;
  increasesCents: number;
  decreasesCents: number;
  losses: readonly LossCarryforward[];
  /** null = el máximo que permita la ley. */
  lossCompensationCents: number | null;
  regime: CorporateTaxRegime;
  customRatePct?: number | null;
  startYear: number;
  /** Cifra de negocios de los 12 meses anteriores al inicio del periodo impositivo (para la D.A. 14.ª). */
  revenueCents?: number | null;
  /** Bonificaciones del periodo. */
  bonusesCents: number;
  /** Retenciones e ingresos a cuenta soportados en el periodo. */
  withholdingsCents: number;
  /** Pagos fraccionados ya ingresados del mismo periodo impositivo. */
  previousInstallmentsCents: number;
};

export type BaseInstallmentResult = {
  method: "base";
  priorBaseCents: number;
  lossesAppliedCents: number;
  lossesApplied: Array<{ originYear: number; amountCents: number }>;
  baseCents: number;
  largeCompany: boolean;
  brackets: BracketQuota[];
  quotaCents: number;
  bonusesCents: number;
  withholdingsCents: number;
  previousInstallmentsCents: number;
  /** Cuota menos bonificaciones, retenciones y pagos anteriores (puede ser negativa). */
  resultCents: number;
  /** Mínimo a ingresar de la D.A. 14.ª (0 si no aplica). */
  minimumCents: number;
  amountCents: number;
};

export function computeBaseInstallment(input: BaseInstallmentInput): BaseInstallmentResult {
  const positive = (cents: number) => Math.max(Math.round(cents), 0);
  const priorBaseCents = Math.round(input.accountingResultBeforeTaxCents) + positive(input.increasesCents) - positive(input.decreasesCents);
  const positivePriorBase = Math.max(priorBaseCents, 0);
  const available = input.losses.reduce((sum, loss) => sum + positive(loss.pendingCents), 0);
  const legalLimit = input.regime === "newCompany" ? Number.MAX_SAFE_INTEGER : Math.max(Math.round((positivePriorBase * LOSS_LIMIT_PCT) / 100), LOSS_MINIMUM_CENTS);
  const requested = input.lossCompensationCents === null ? Number.MAX_SAFE_INTEGER : positive(input.lossCompensationCents);
  const lossesAppliedCents = Math.min(requested, available, legalLimit, positivePriorBase);
  const baseCents = priorBaseCents - lossesAppliedCents;

  const largeCompany = isLargeCompany(input.revenueCents);
  const schedule = corporateTaxRateSchedule({ regime: input.regime, startYear: input.startYear, customRatePct: input.customRatePct });
  const brackets = applyRateSchedule(baseCents, schedule.brackets.map((bracket) => ({ upToCents: bracket.upToCents, pct: baseMethodPct(bracket.pct, largeCompany) })));
  const quotaCents = brackets.reduce((sum, bracket) => sum + bracket.quotaCents, 0);

  const bonusesCents = positive(input.bonusesCents);
  const withholdingsCents = positive(input.withholdingsCents);
  const previousInstallmentsCents = positive(input.previousInstallmentsCents);
  const resultCents = quotaCents - bonusesCents - withholdingsCents - previousInstallmentsCents;
  const minimumCents = largeCompany
    ? Math.max(Math.round((Math.max(Math.round(input.accountingResultBeforeTaxCents), 0) * LARGE_COMPANY_MINIMUM_PCT) / 100) - previousInstallmentsCents, 0)
    : 0;

  return {
    method: "base",
    priorBaseCents,
    lossesAppliedCents,
    lossesApplied: allocateLosses(input.losses, lossesAppliedCents).applied,
    baseCents,
    largeCompany,
    brackets,
    quotaCents,
    bonusesCents,
    withholdingsCents,
    previousInstallmentsCents,
    resultCents,
    minimumCents,
    amountCents: Math.max(resultCents, minimumCents, 0),
  };
}
