/**
 * Modelos de la Agencia Tributaria Canaria (funciones puras): 420 (IGIC trimestral), 425
 * (resumen anual del IGIC) y 450 (AIEM trimestral), con las casillas de sus instrucciones
 * oficiales. Reutilizan los mismos acumulados que el 303 (`computeIssuedVat` /
 * `computeSupplierVat`), así que cuadran con el libro registro y con la contabilidad.
 *
 * - 420: IGIC devengado por tipo en filas 01-03 … 16-18 (base, tipo, cuota; incluido el tipo
 *   cero), 19-20 inversión del sujeto pasivo, 25 total devengado; deducible 26-33, 40 total, 41
 *   diferencia, 45 resultado (41 + 42 − 43 − 44); 46 exportaciones y exentas con derecho a
 *   deducción; 47 no sujetas con derecho a deducción y entregas con inversión del sujeto pasivo.
 * - 425: régimen ordinario 01-18, 74 total bases, 75-76 inversión del sujeto pasivo, 79 total
 *   devengado; deducciones 80-87, 94 total, 95 resultado régimen general, 113 suma de
 *   resultados, 115 resultado anual; volumen de operaciones 120-134; REPEP 142-147.
 * - 450: régimen general por tipo (base, tipo, cuota), casilla 6 total cuotas y 15 resultado.
 * Las casillas que dependen de datos que la aplicación no registra (compensaciones de periodos
 * anteriores, regularizaciones de prorrata o de bienes de inversión, complementarias) se dejan a
 * cero y la ficha del modelo lo advierte.
 */

import type { IssuedVatResult, Modelo303Box, SupplierVatResult } from "@/server/fiscal/spain-calc";
import { centsToNumber } from "@/server/taxation/engine";

type CentsBucket = { rate: number; base: number; tax: number };

const money = (cents: number) => centsToNumber(cents);

function rateLabel(rate: number) {
  return `${rate.toLocaleString("es-ES", { maximumFractionDigits: 3 })} %`;
}

/** Filas de IGIC devengado por tipo (tipo cero incluido), en orden ascendente de tipo. */
function igicOutputRows(issued: IssuedVatResult): CentsBucket[] {
  const rows = new Map<number, CentsBucket>();
  if (issued.zeroRated.DOMESTIC !== 0) rows.set(0, { rate: 0, base: issued.zeroRated.DOMESTIC, tax: 0 });
  for (const bucket of issued.vat.values()) rows.set(bucket.rate, { ...bucket });
  return [...rows.values()].sort((left, right) => left.rate - right.rate);
}

function rateBoxes(rows: CentsBucket[], triplets: number, firstBox = 1, tax = "IGIC"): Modelo303Box[] {
  const boxes: Modelo303Box[] = [];
  rows.forEach((row, index) => {
    if (index >= triplets) {
      boxes.push({ box: "REV", label: `Revisar: ${tax} devengado al ${rateLabel(row.rate)} no cabe en las ${triplets} filas de tipos del modelo`, amount: money(row.tax), kind: "tax" });
      return;
    }
    const base = String(firstBox + index * 3).padStart(2, "0");
    const quota = String(firstBox + index * 3 + 2).padStart(2, "0");
    boxes.push({ box: base, label: `Base ${tax} devengado al ${rateLabel(row.rate)}`, amount: money(row.base), kind: "base" });
    boxes.push({ box: quota, label: `Cuota ${tax} devengado al ${rateLabel(row.rate)}`, amount: money(row.tax), kind: "tax" });
  });
  return boxes;
}

function selfAssessed(supplier: SupplierVatResult) {
  return {
    base: supplier.selfAssessed.reverseCharge.base + supplier.selfAssessed.intraEu.base,
    tax: supplier.selfAssessed.reverseCharge.tax + supplier.selfAssessed.intraEu.tax,
  };
}

function outputTotals(issued: IssuedVatResult, supplier: SupplierVatResult) {
  const rows = igicOutputRows(issued);
  const isp = selfAssessed(supplier);
  const outputTax = rows.reduce((sum, row) => sum + row.tax, 0);
  const outputBase = rows.reduce((sum, row) => sum + row.base, 0);
  return { rows, isp, accrued: outputTax + isp.tax, outputBase };
}

function deductions(supplier: SupplierVatResult) {
  const { domesticCurrent, domesticInvestment, importCurrent, importInvestment } = supplier.deductible;
  return { domesticCurrent, domesticInvestment, importCurrent, importInvestment, total: supplier.deductibleCents };
}

export type CanaryReturnResult = { boxes: Modelo303Box[]; resultCents: number };

/** Modelo 420: autoliquidación trimestral del IGIC (régimen general). */
export function buildModelo420(issued: IssuedVatResult, supplier: SupplierVatResult): CanaryReturnResult {
  const { rows, isp, accrued } = outputTotals(issued, supplier);
  const deductible = deductions(supplier);
  const difference = accrued - deductible.total;
  const boxes: Modelo303Box[] = [
    ...rateBoxes(rows, 6),
    { box: "19", label: "Base adquisiciones con inversión del sujeto pasivo", amount: money(isp.base), kind: "base" },
    { box: "20", label: "Cuota adquisiciones con inversión del sujeto pasivo", amount: money(isp.tax), kind: "tax" },
    { box: "25", label: "Total cuotas devengadas", amount: money(accrued), kind: "tax" },
    { box: "26", label: "Base deducible · operaciones interiores corrientes", amount: money(deductible.domesticCurrent.base), kind: "base" },
    { box: "27", label: "Cuota deducible · operaciones interiores corrientes", amount: money(deductible.domesticCurrent.tax), kind: "tax" },
  ];
  const optional: Array<[string, string, string, { base: number; tax: number }]> = [
    ["28", "29", "operaciones interiores con bienes de inversión", deductible.domesticInvestment],
    ["30", "31", "importaciones de bienes corrientes", deductible.importCurrent],
    ["32", "33", "importaciones de bienes de inversión", deductible.importInvestment],
  ];
  for (const [baseBox, taxBox, label, values] of optional) {
    if (values.base === 0 && values.tax === 0) continue;
    boxes.push({ box: baseBox, label: `Base deducible · ${label}`, amount: money(values.base), kind: "base" });
    boxes.push({ box: taxBox, label: `Cuota deducible · ${label}`, amount: money(values.tax), kind: "tax" });
  }
  boxes.push(
    { box: "40", label: "Total cuotas deducibles", amount: money(deductible.total), kind: "tax" },
    { box: "41", label: "Diferencia (25 − 40)", amount: money(difference), kind: "settlement" },
    { box: "45", label: "Resultado (41 + 42 − 43 − 44, sin cuotas a compensar de periodos anteriores)", amount: money(difference), kind: "settlement" },
  );
  const exempt46 = issued.zeroRated.EXPORT;
  const notSubject47 = issued.zeroRated.NOT_SUBJECT + issued.zeroRated.REVERSE_CHARGE;
  if (exempt46 !== 0) boxes.push({ box: "46", label: "Exportaciones y otras operaciones exentas con derecho a deducción", amount: money(exempt46), kind: "info" });
  if (notSubject47 !== 0) boxes.push({ box: "47", label: "Operaciones no sujetas con derecho a deducción y entregas con inversión del sujeto pasivo", amount: money(notSubject47), kind: "info" });
  return { boxes, resultCents: difference };
}

/**
 * Modelo 425: declaración-resumen anual del IGIC. `regime` decide el apartado: régimen general
 * (casillas 01-134) o, en el REPEP, solo la declaración informativa del volumen (142-147).
 */
export function buildModelo425(issued: IssuedVatResult, supplier: SupplierVatResult, regime: string): CanaryReturnResult {
  const exemptSales = issued.zeroRated.EXEMPT;
  if (regime === "pequeno_empresario") {
    const total = issued.zeroRated.DOMESTIC + exemptSales + issued.zeroRated.EXPORT + issued.zeroRated.NOT_SUBJECT + issued.zeroRated.REVERSE_CHARGE;
    const notSubject = issued.zeroRated.NOT_SUBJECT;
    return {
      boxes: [
        { box: "142", label: "Operaciones sujetas exentas por el REPEP (art. 110.1 Ley 4/2012)", amount: money(total - notSubject), kind: "info" },
        { box: "144", label: "Entregas y servicios no sujetos al IGIC", amount: money(notSubject), kind: "info" },
        { box: "147", label: "Total volumen de operaciones en el REPEP", amount: money(total), kind: "info" },
      ],
      resultCents: 0,
    };
  }

  const { rows, isp, accrued, outputBase } = outputTotals(issued, supplier);
  const deductible = deductions(supplier);
  const result = accrued - deductible.total;
  const boxes: Modelo303Box[] = [
    ...rateBoxes(rows, 6),
    { box: "74", label: "Total bases IGIC", amount: money(outputBase), kind: "base" },
    { box: "75", label: "Base adquisiciones con inversión del sujeto pasivo", amount: money(isp.base), kind: "base" },
    { box: "76", label: "Cuota adquisiciones con inversión del sujeto pasivo", amount: money(isp.tax), kind: "tax" },
    { box: "79", label: "Total cuotas devengadas", amount: money(accrued), kind: "tax" },
    { box: "80", label: "Base deducible · operaciones interiores corrientes", amount: money(deductible.domesticCurrent.base), kind: "base" },
    { box: "81", label: "Cuota deducible · operaciones interiores corrientes", amount: money(deductible.domesticCurrent.tax), kind: "tax" },
  ];
  const optional: Array<[string, string, string, { base: number; tax: number }]> = [
    ["82", "83", "operaciones interiores con bienes de inversión", deductible.domesticInvestment],
    ["84", "85", "importaciones de bienes corrientes", deductible.importCurrent],
    ["86", "87", "importaciones de bienes de inversión", deductible.importInvestment],
  ];
  for (const [baseBox, taxBox, label, values] of optional) {
    if (values.base === 0 && values.tax === 0) continue;
    boxes.push({ box: baseBox, label: `Base deducible · ${label}`, amount: money(values.base), kind: "base" });
    boxes.push({ box: taxBox, label: `Cuota deducible · ${label}`, amount: money(values.tax), kind: "tax" });
  }
  boxes.push(
    { box: "94", label: "Total cuotas deducibles", amount: money(deductible.total), kind: "tax" },
    { box: "95", label: "Resultado régimen general (79 − 94)", amount: money(result), kind: "settlement" },
    { box: "113", label: "Suma de resultados", amount: money(result), kind: "settlement" },
    { box: "115", label: "Resultado de la liquidación anual (sin cuotas a compensar del ejercicio anterior)", amount: money(result), kind: "settlement" },
  );

  // Volumen de operaciones (sin IGIC).
  const generalRegime = outputBase;
  const exports = issued.zeroRated.EXPORT;
  const minoristaExempt = regime === "comerciante_minorista" ? exemptSales : 0;
  const exemptNoDeduction = regime === "comerciante_minorista" ? 0 : exemptSales;
  const notSubject = issued.zeroRated.NOT_SUBJECT + issued.zeroRated.REVERSE_CHARGE;
  const volume: Array<[string, string, number]> = [
    ["120", "Operaciones en régimen general", generalRegime],
    ["122", "Exportaciones definitivas y operaciones asimiladas", exports],
    ["126", "Operaciones exentas sin derecho a deducción", exemptNoDeduction],
    ["128", "Operaciones no sujetas por reglas de localización o con inversión del sujeto pasivo", notSubject],
  ];
  for (const [box, label, cents] of volume) {
    if (cents !== 0 || box === "120") boxes.push({ box, label, amount: money(cents), kind: "info" });
  }
  boxes.push({ box: "134", label: "Total volumen de operaciones", amount: money(generalRegime + exports + exemptNoDeduction + notSubject), kind: "info" });
  if (minoristaExempt !== 0) {
    boxes.push({ box: "143", label: "Operaciones exentas por el régimen especial del comerciante minorista (art. 50.Uno.27º Ley 4/2012)", amount: money(minoristaExempt), kind: "info" });
  }
  return { boxes, resultCents: result };
}

/** Cuotas del AIEM por tipo (impuestos AIEM de las facturas emitidas del periodo). */
export type AiemBucket = { rate: number; baseCents: number; taxCents: number };

/** Modelo 450: autoliquidación trimestral del AIEM (régimen general). */
export function buildModelo450(buckets: AiemBucket[]): CanaryReturnResult {
  const sorted = [...buckets].sort((left, right) => left.rate - right.rate);
  const total = sorted.reduce((sum, bucket) => sum + bucket.taxCents, 0);
  const boxes: Modelo303Box[] = [];
  for (const bucket of sorted) {
    boxes.push({ box: "", label: `Base imponible AIEM al ${rateLabel(bucket.rate)}`, amount: money(bucket.baseCents), kind: "base" });
    boxes.push({ box: "", label: `Cuota AIEM al ${rateLabel(bucket.rate)}`, amount: money(bucket.taxCents), kind: "tax" });
  }
  boxes.push(
    { box: "6", label: "Total cuotas", amount: money(total), kind: "tax" },
    { box: "15", label: "Resultado de la liquidación (sin compensaciones ni complementarias)", amount: money(total), kind: "settlement" },
  );
  return { boxes, resultCents: total };
}
