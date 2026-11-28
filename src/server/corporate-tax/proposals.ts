/**
 * Propuestas a partir de los saldos del libro para dos partidas de la liquidación que el usuario
 * revisa y puede cambiar: la limitación de gastos financieros (art. 16 de la Ley 27/2014) y la
 * reserva de capitalización (art. 25). Funciones puras en céntimos.
 *
 * Texto de ambos artículos contrastado el 28-11-2026 con el BOE consolidado (BOE-A-2014-12328):
 * - Art. 16.1: los gastos financieros netos (exceso de gastos financieros sobre los ingresos por
 *   cesión a terceros de capitales propios) son deducibles hasta el 30 % del beneficio operativo; en
 *   todo caso, 1 millón (prorrateado si el periodo es inferior al año, art. 16.4). Beneficio
 *   operativo = resultado de explotación sin amortizaciones, sin imputación de subvenciones de
 *   inmovilizado no financiero y sin deterioro y resultado por enajenaciones de inmovilizado, más
 *   los dividendos de participaciones de al menos el 5 %.
 * - Art. 25.1 (redacción para periodos iniciados desde el 1-1-2025, Ley 7/2024): reducción del 20 %
 *   del incremento de fondos propios (23 %, 26,5 % o 30 % si la plantilla media crece al menos un
 *   2 %, 5 % o 10 %), con el tope sobre la base previa que ya aplica `computeCorporateTax`.
 *   Art. 25.2: incremento = fondos propios al cierre sin el resultado del ejercicio − fondos propios
 *   al inicio sin el resultado del ejercicio anterior, sin contar aportaciones de socios, reservas
 *   legales o estatutarias, reservas de nivelación y otras partidas que se enumeran.
 *
 * Lo que la propuesta NO sabe (y se dice en la explicación): el porcentaje de participación de los
 * dividendos, los gastos financieros no deducidos o el límite no usado de ejercicios anteriores
 * (art. 16.1 y 16.2), el aumento de plantilla, la reserva de nivelación dotada dentro de las
 * reservas voluntarias y las ampliaciones por compensación de créditos.
 */

export const FINANCIAL_EXPENSES_LIMIT_PCT = 30;
export const FINANCIAL_EXPENSES_MINIMUM_CENTS = 1_000_000_00;

export type FinancialExpensesInput = {
  /** Gastos financieros por deudas (cuentas 661, 662, 664 y 669), en positivo. */
  financialExpensesCents: number;
  /** Ingresos por cesión a terceros de capitales propios: intereses (cuentas 761, 762 y 769), en positivo. */
  financialIncomeCents: number;
  /** Resultado de explotación (epígrafe A de la cuenta de pérdidas y ganancias), con su signo. */
  operatingResultCents: number;
  /** Amortización del inmovilizado (epígrafe 8), como gasto en positivo. */
  depreciationCents: number;
  /** Imputación de subvenciones de inmovilizado no financiero (epígrafe 9), como ingreso en positivo. */
  capitalSubsidiesCents: number;
  /** Deterioro y resultado por enajenaciones del inmovilizado (epígrafe 11), con su signo (+ beneficio). */
  assetDisposalResultCents: number;
  /** Días del periodo impositivo (para el prorrateo del millón). */
  periodDays: number;
};

export type FinancialExpensesProposal = {
  netFinancialExpensesCents: number;
  operatingProfitCents: number;
  limitCents: number;
  minimumCents: number;
  /** Gastos financieros netos no deducibles este ejercicio (ajuste positivo, temporario). */
  excessCents: number;
  explanation: string;
};

const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const fmt = (cents: number) => euros.format(cents / 100);

export function proposeFinancialExpensesLimit(input: FinancialExpensesInput): FinancialExpensesProposal {
  const netFinancialExpensesCents = Math.max(Math.round(input.financialExpensesCents) - Math.round(input.financialIncomeCents), 0);
  const operatingProfitCents = Math.round(input.operatingResultCents + input.depreciationCents - input.capitalSubsidiesCents - input.assetDisposalResultCents);
  const days = Math.min(Math.max(Math.round(input.periodDays), 1), 366);
  const minimumCents = days >= 365 ? FINANCIAL_EXPENSES_MINIMUM_CENTS : Math.round((FINANCIAL_EXPENSES_MINIMUM_CENTS * days) / 365);
  const limitCents = Math.max(Math.round((Math.max(operatingProfitCents, 0) * FINANCIAL_EXPENSES_LIMIT_PCT) / 100), minimumCents);
  const excessCents = Math.max(netFinancialExpensesCents - limitCents, 0);
  const explanation = [
    `Gastos financieros netos: ${fmt(netFinancialExpensesCents)} (gastos por intereses de deudas menos ingresos por intereses).`,
    `Beneficio operativo: ${fmt(operatingProfitCents)} (resultado de explotación sin amortizaciones, subvenciones de capital ni resultados del inmovilizado).`,
    `Son deducibles hasta el mayor entre el 30 % del beneficio operativo y ${fmt(minimumCents)}: ${fmt(limitCents)}.`,
    excessCents > 0
      ? `El exceso de ${fmt(excessCents)} no es deducible este año y podrá deducirse en los siguientes (art. 16.1).`
      : "No hay exceso: todos los gastos financieros son deducibles.",
    "No se tienen en cuenta los dividendos de participaciones de al menos el 5 % (aumentan el beneficio operativo) ni lo pendiente de ejercicios anteriores.",
  ].join(" ");
  return { netFinancialExpensesCents, operatingProfitCents, limitCents, minimumCents, excessCents, explanation };
}

/** Porcentaje de reducción por reserva de capitalización (art. 25.1) sin aumento de plantilla; null antes de 2025 (no contrastado). */
export function capitalizationReductionPct(startYear: number) {
  return startYear >= 2025 ? 20 : null;
}

export type CapitalizationReserveInput = {
  /** Fondos propios computables al inicio (sin el resultado del ejercicio anterior ni las partidas excluidas). */
  openingEquityCents: number;
  /** Fondos propios computables al cierre (sin el resultado del ejercicio ni las partidas excluidas). */
  closingEquityCents: number;
  startYear: number;
};

export type CapitalizationReserveProposal = {
  openingEquityCents: number;
  closingEquityCents: number;
  increaseCents: number;
  pct: number;
  /** Reducción propuesta antes del tope sobre la base previa (lo aplica la liquidación). */
  reductionCents: number;
  explanation: string;
};

export function proposeCapitalizationReserve(input: CapitalizationReserveInput): CapitalizationReserveProposal | null {
  const pct = capitalizationReductionPct(input.startYear);
  if (pct === null) return null;
  const increaseCents = Math.max(Math.round(input.closingEquityCents) - Math.round(input.openingEquityCents), 0);
  const reductionCents = Math.round((increaseCents * pct) / 100);
  const explanation = [
    `Fondos propios computables al inicio: ${fmt(input.openingEquityCents)}; al cierre: ${fmt(input.closingEquityCents)}.`,
    `Se cuentan las reservas voluntarias y otras reservas (113, 114 salvo la 1141, 115 y 119) y los resultados de ejercicios anteriores (120 y 121); no el capital, la prima de emisión ni las aportaciones de socios (aportaciones), la reserva legal (112) ni la estatutaria (1141), ni el resultado del ejercicio (129 y cuentas de gastos e ingresos).`,
    increaseCents > 0
      ? `Incremento: ${fmt(increaseCents)}; reducción del ${pct} %: ${fmt(reductionCents)}, con el tope sobre la base imponible previa.`
      : "Los fondos propios computables no han aumentado: no hay reducción.",
    "Requisitos: dotar una reserva indisponible por el importe de la reducción y mantener el incremento 3 años. Si la plantilla media creció al menos un 2 %, el porcentaje sube al 23 %, 26,5 % o 30 %. Quita la reserva de nivelación si la tienes dentro de las voluntarias.",
  ].join(" ");
  return { openingEquityCents: Math.round(input.openingEquityCents), closingEquityCents: Math.round(input.closingEquityCents), increaseCents, pct, reductionCents, explanation };
}

/** Cuentas de fondos propios que computan para el incremento del art. 25.2 (ver la explicación). */
export const CAPITALIZATION_EQUITY_PREFIXES = ["113", "114", "115", "119", "120", "121"] as const;
export const CAPITALIZATION_EQUITY_EXCLUDED = ["1141"] as const;

export function isCapitalizationEquityAccount(code: string) {
  return CAPITALIZATION_EQUITY_PREFIXES.some((prefix) => code.startsWith(prefix)) && !CAPITALIZATION_EQUITY_EXCLUDED.some((prefix) => code.startsWith(prefix));
}

/** Cuentas del art. 16: gastos por intereses de deudas e ingresos por intereses. */
export const FINANCIAL_EXPENSE_PREFIXES = ["661", "662", "664", "669"] as const;
export const FINANCIAL_INCOME_PREFIXES = ["761", "762", "769"] as const;
