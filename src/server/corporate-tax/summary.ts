/**
 * Recorrido de la liquidación (del resultado contable a la cuota diferencial) como lista de líneas,
 * para la pantalla, el resumen imprimible y la hoja de cálculo. Función pura.
 */

import type { XlsxCell } from "@/lib/xlsx-lite";
import type { OfficialStatements } from "@/server/accounting/official-statements-model";
import type { CorporateTaxResult, TaxAdjustment, TaxCredit } from "@/server/corporate-tax/liquidation";
import { ADJUSTMENT_BOXES, formatModel200Box, LIQUIDATION_BOXES, MODEL_200_BOXES_SOURCE, statementBox, TAX_RATE_BOX, taxRateBoxValue, type Model200Box } from "@/server/corporate-tax/model-200-boxes";

export type LiquidationRow = {
  key: string;
  label: string;
  /** Importe con su signo natural (los que restan, en negativo). */
  cents: number;
  /** total: subtotal destacado; detail: línea de detalle sangrada. */
  kind: "total" | "line" | "detail";
  /** Casilla del modelo 200 en la que va el importe (solo las contrastadas; ver `model-200-boxes.ts`). */
  box: Model200Box | null;
};

type SummaryView = {
  year: { code: string; start: string; end: string };
  inputs: { adjustments: readonly TaxAdjustment[]; credits: readonly TaxCredit[] };
  result: CorporateTaxResult;
};

const pct = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export function liquidationRows(view: SummaryView): LiquidationRow[] {
  const { result } = view;
  const rows: LiquidationRow[] = [];
  const push = (key: string, label: string, cents: number, kind: LiquidationRow["kind"] = "line", box: Model200Box | null = LIQUIDATION_BOXES[key] ?? null) => rows.push({ key, label, cents, kind, box });

  push("accounting-result", "Resultado contable antes de impuestos", result.accountingResultBeforeTaxCents, "total");
  push("increases", "(+) Ajustes positivos", result.increasesCents);
  for (const item of view.inputs.adjustments.filter((entry) => entry.sign === "increase" && entry.amountCents > 0)) push(`adj-${item.id}`, item.concept, item.amountCents, "detail", ADJUSTMENT_BOXES[item.kind] ?? null);
  push("decreases", "(−) Ajustes negativos", -result.decreasesCents);
  for (const item of view.inputs.adjustments.filter((entry) => entry.sign === "decrease" && entry.amountCents > 0)) push(`adj-${item.id}`, item.concept, -item.amountCents, "detail", ADJUSTMENT_BOXES[item.kind] ?? null);
  push("prior-base", "Base imponible previa", result.priorBaseCents, "total");
  if (result.capitalizationReserve.appliedCents > 0) push("capitalization", "(−) Reserva de capitalización", -result.capitalizationReserve.appliedCents);
  push("losses", "(−) Compensación de bases imponibles negativas de ejercicios anteriores", -result.losses.appliedCents);
  for (const loss of result.losses.applied) push(`loss-${loss.originYear}`, `Base negativa de ${loss.originYear}`, -loss.amountCents, "detail");
  push("taxable-base", "Base imponible", result.taxableBaseCents, "total");
  if (result.leveling.reductionAppliedCents > 0 || result.leveling.additionCents > 0) {
    if (result.leveling.reductionAppliedCents > 0) push("leveling-reduction", "(−) Reserva de nivelación (minoración)", -result.leveling.reductionAppliedCents);
    if (result.leveling.additionCents > 0) push("leveling-addition", "(+) Reserva de nivelación (adición)", result.leveling.additionCents);
    push("rate-base", "Base imponible tras la reserva de nivelación", result.rateBaseCents, "total");
  }
  // La casilla del tipo [00558] no es un importe: se indica su contenido en la primera línea (nota 1 de la pág. 14).
  const rateBoxValue = taxRateBoxValue(result.brackets.map((bracket) => bracket.pct));
  result.brackets.forEach((bracket, index) => {
    const rateHint = index === 0 && rateBoxValue ? ` · casilla ${TAX_RATE_BOX.box}: «${rateBoxValue}»` : "";
    push(`bracket-${index}`, `Tipo de gravamen del ${pct.format(bracket.pct)} % sobre ${euros.format(bracket.baseCents / 100)}${rateHint}`, bracket.quotaCents, "detail", null);
  });
  push("gross-quota", "Cuota íntegra", result.grossQuotaCents, "total");
  push("credits", "(−) Bonificaciones y deducciones", -result.creditsAppliedCents);
  for (const credit of view.inputs.credits.filter((entry) => entry.amountCents > 0)) push(`credit-${credit.id}`, credit.concept, -credit.amountCents, "detail", null);
  push("net-quota", "Cuota líquida", result.netQuotaCents, "total");
  push("withholdings", "(−) Retenciones e ingresos a cuenta", -result.withholdingsCents);
  push("quota-of-year", "Cuota del ejercicio a ingresar o a devolver", result.netQuotaCents - result.withholdingsCents, "total");
  push("installments", "(−) Pagos fraccionados (modelos 202; en el modelo 200, casillas 00601, 00603 y 00605 de la pág. 14 bis)", -result.installmentsCents);
  push("differential", result.differentialCents < 0 ? "Cuota diferencial: a devolver" : "Cuota diferencial: a ingresar", result.differentialCents, "total");
  if (result.generatedLossCents > 0) push("generated-loss", "Base imponible negativa del ejercicio, a compensar en los siguientes", result.generatedLossCents, "line", null);
  return rows;
}

/** Filas de la hoja de cálculo: liquidación, balance y cuenta de pérdidas y ganancias (modelo abreviado). */
export function summaryWorkbookRows(view: SummaryView, official: { statements: OfficialStatements; previousYearCode: string | null }): XlsxCell[][] {
  const rows: XlsxCell[][] = [
    [`Impuesto sobre Sociedades · ejercicio ${view.year.code}`],
    ["Importes preparados para trasladar a Sociedades WEB. El programa no presenta el modelo 200 ni genera su fichero."],
    [`Casillas según el ${MODEL_200_BOXES_SOURCE.label}. Las líneas sin casilla no tienen una equivalente única en el modelo.`],
    [],
    ["LIQUIDACIÓN", "Importe", "Casilla (página)"],
    ...liquidationRows(view).map((row): XlsxCell[] => [row.kind === "detail" ? `      ${row.label}` : row.label, row.cents / 100, formatModel200Box(row.box)]),
    [],
  ];
  const sections: Array<[string, OfficialStatements["assets"]]> = [
    ["BALANCE ABREVIADO · ACTIVO", official.statements.assets],
    ["BALANCE ABREVIADO · PATRIMONIO NETO Y PASIVO", official.statements.equityAndLiabilities],
    ["CUENTA DE PÉRDIDAS Y GANANCIAS ABREVIADA", official.statements.incomeStatement],
  ];
  for (const [title, lines] of sections) {
    rows.push([title, view.year.code, official.previousYearCode ?? "Ejercicio anterior", "Casilla (página)"]);
    for (const line of lines) rows.push([`${"   ".repeat(line.depth)}${line.label}`, line.amount, line.previous, formatModel200Box(statementBox(line.id))]);
    rows.push([]);
  }
  return rows;
}
