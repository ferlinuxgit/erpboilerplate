import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

/**
 * CSV de un modelo fiscal (mismo contenido que el PDF): separador ";", BOM UTF-8 y coma decimal,
 * para que Excel en español lo abra en columnas. Protege frente a inyección de fórmulas.
 *
 * Se construye a partir del resumen que se enseña (la foto de lo presentado si la hay), así que
 * todo lo que lleva el resumen viaja: casillas del 303 y su liquidación (110, 78, 87), casillas
 * numeradas del 390, criterio de caja y prorrata, marcas y trimestres del 347, bases rectificadas
 * del 349 y casillas y perceptores de los modelos de retenciones.
 */

type CsvValue = string | number | null;
type CsvRow = CsvValue[];

/** Número que no es un importe (perceptores, rentas): sale sin decimales y sin símbolo de euro. */
type Count = { count: number };

/**
 * Fila de detalle de un modelo, común al CSV y al PDF: sección, casilla o clave, concepto, NIF e
 * importe (en euros; `{ count }` si es un número de perceptores o de rentas).
 */
export type FiscalDetailRow = { section: string; box: string | null; label: string; taxId: string | null; amount: number | Count | null };

function cell(value: CsvValue | Count | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return String(value.count);
  const text = typeof value === "number" ? value.toFixed(2).replace(".", ",") : String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const euros = (cents: number) => Math.round(cents) / 100;

/** Filas de un modelo de retenciones: casillas de la autoliquidación y perceptores del resumen anual. */
function withholdingRows(summary: SpanishFiscalSummary): Array<Array<CsvValue | Count>> {
  const model = summary.withholdingModel;
  if (!model) return [];
  const rows: Array<Array<CsvValue | Count>> = [];
  for (const box of model.boxes) {
    rows.push([`Casillas ${model.code}`, box.box, box.label, null, box.kind === "count" ? { count: box.amount } : box.amount]);
  }
  for (const recipient of model.modelo190?.recipients ?? []) {
    const key = `${recipient.key}${recipient.subkey ? `.${recipient.subkey}` : ""}`;
    rows.push(
      ["Perceptores 190 · dinerario", key, recipient.name, recipient.taxId, euros(recipient.cashCents)],
      ["Perceptores 190 · retenciones", key, recipient.name, recipient.taxId, euros(recipient.withheldCents)],
    );
    if (recipient.inKindCents !== 0 || recipient.inKindWithheldCents !== 0) {
      rows.push(
        ["Perceptores 190 · en especie", key, recipient.name, recipient.taxId, euros(recipient.inKindCents)],
        ["Perceptores 190 · ingresos a cuenta", key, recipient.name, recipient.taxId, euros(recipient.inKindWithheldCents)],
      );
    }
  }
  for (const recipient of model.modelo180?.recipients ?? []) {
    const property = recipient.property?.cadastralReference ? ` · ref. catastral ${recipient.property.cadastralReference}` : "";
    rows.push(
      ["Arrendadores 180 · base", recipient.modality === "2" ? "En especie" : "Dineraria", `${recipient.name}${property}`, recipient.taxId, euros(recipient.baseCents)],
      ["Arrendadores 180 · retenciones", recipient.rate === null ? null : `${recipient.rate}%`, `${recipient.name}${property}`, recipient.taxId, euros(recipient.withheldCents)],
    );
  }
  for (const recipient of model.modelo193?.recipients ?? []) {
    const key = `${recipient.key}.${recipient.nature}`;
    rows.push(
      ["Perceptores 193 · base", key, recipient.name, recipient.taxId, euros(recipient.baseCents)],
      ["Perceptores 193 · retenciones", recipient.rate === null ? key : `${key} · ${recipient.rate}%`, recipient.name, recipient.taxId, euros(recipient.withheldCents)],
    );
  }
  const annual = model.modelo190 ?? model.modelo180 ?? model.modelo193;
  if (annual) {
    rows.push(
      ["Cuadre con las autoliquidaciones", null, `Retenciones del resumen anual ${model.code}`, null, euros(annual.reconciliation.annualCents)],
      ["Cuadre con las autoliquidaciones", null, "Suma de las autoliquidaciones del año", null, euros(annual.reconciliation.periodicCents)],
      ["Cuadre con las autoliquidaciones", null, annual.reconciliation.balanced ? "Diferencia (cuadra)" : "Diferencia (NO cuadra)", null, euros(annual.reconciliation.differenceCents)],
    );
  }
  return rows;
}

export function fiscalSummaryToCsvRows(summary: SpanishFiscalSummary): CsvRow[] {
  return fiscalSummaryToCsvCells(summary).map((row) => row.map((value) => (value !== null && typeof value === "object" ? value.count : value)));
}

/**
 * Detalle del modelo (casillas, liquidación, perceptores, operadores, terceros…), sin la cabecera
 * ni los documentos de origen. Es lo que pintan el CSV y el PDF.
 */
export function fiscalSummaryDetailRows(summary: SpanishFiscalSummary): FiscalDetailRow[] {
  return detailCells(summary).map(([section, box, label, taxId, amount]) => ({
    section: String(section),
    box: box === null ? null : String(box),
    label: String(label ?? ""),
    taxId: taxId === null ? null : String(taxId),
    amount: amount === null || typeof amount === "object" ? amount : typeof amount === "number" ? amount : null,
  }));
}

function fiscalSummaryToCsvCells(summary: SpanishFiscalSummary): Array<Array<CsvValue | Count>> {
  const rows: Array<Array<CsvValue | Count>> = [["Sección", "Casilla / clave", "Concepto", "NIF", "Importe"]];
  rows.push(["Modelo", summary.code, `${summary.modelName} · ${summary.periodLabel}`, null, summary.amountDue]);
  rows.push(...detailCells(summary));
  for (const document of summary.sourceDocuments.salesInvoices) rows.push(["Facturas emitidas", document.issueDate.slice(0, 10), document.number, null, document.taxBase]);
  for (const document of summary.sourceDocuments.supplierInvoices) rows.push(["Facturas recibidas", document.issueDate.slice(0, 10), document.number, null, document.taxBase]);
  return rows;
}

function detailCells(summary: SpanishFiscalSummary): Array<Array<CsvValue | Count>> {
  const rows: Array<Array<CsvValue | Count>> = [];
  if (summary.modelo130) {
    for (const box of summary.modelo130.boxes) rows.push(["Modelo 130", box.box, box.label, null, box.amount]);
  } else if (summary.modelo349) {
    for (const operator of summary.modelo349.operators) rows.push(["Operadores 349", operator.key, `${operator.name} (${operator.countryCode})`, operator.taxId, operator.amount]);
    for (const operator of summary.modelo349.rectifications) {
      const label = `${operator.name} (${operator.countryCode}, periodo ${operator.originalPeriod})`;
      rows.push(["Rectificaciones 349 · diferencia", operator.key, label, operator.taxId, operator.amount]);
      // Lo que pide el modelo: la base declarada antes y la base total correcta (no la diferencia).
      if (operator.previousAmount !== undefined) rows.push(["Rectificaciones 349 · base declarada anteriormente", operator.key, label, operator.taxId, operator.previousAmount]);
      if (operator.rectifiedAmount !== undefined) rows.push(["Rectificaciones 349 · base imponible rectificada", operator.key, label, operator.taxId, operator.rectifiedAmount]);
    }
  } else if (summary.withholdingModel) {
    rows.push(...withholdingRows(summary));
  } else {
    if (summary.code === "303") {
      for (const box of summary.modelo303Boxes) rows.push(["Casillas 303", box.box, box.label, null, box.amount]);
      const settlement = summary.vatSettlement;
      if (settlement) {
        rows.push(
          ["Liquidación 303", "110", "Cuotas a compensar pendientes de periodos anteriores", null, settlement.pendingBefore],
          ["Liquidación 303", "78", "Cuotas a compensar aplicadas en este periodo", null, settlement.applied],
          ["Liquidación 303", "87", "Cuotas pendientes para periodos posteriores (110 − 78)", null, settlement.pendingAfter],
          ["Liquidación 303", "71", "Resultado", null, settlement.result],
          ["Liquidación 303", null, "Saldo a favor al terminar el periodo", null, settlement.carryForward],
        );
      }
    }
    // 390: casillas con la numeración oficial del modelo (las que el programa calcula).
    for (const box of summary.annualSummaryBoxes ?? []) rows.push(["Casillas 390", box.box || null, box.label, null, box.amount]);
    const cash = summary.cashAccounting;
    if (cash) {
      const [base, tax, purchaseBase, purchaseTax] = summary.code === "390" ? ["654", "655", "656", "657"] : ["62", "63", "74", "75"];
      rows.push(
        ["Criterio de caja", null, cash.ownRegime ? "Acogida al régimen especial del criterio de caja" : "Destinataria de operaciones en criterio de caja", null, null],
        ["Criterio de caja", base, "Entregas y servicios · base según la regla general de devengo", null, cash.salesBase],
        ["Criterio de caja", tax, "Entregas y servicios · cuota según la regla general de devengo", null, cash.salesTax],
        ["Criterio de caja", purchaseBase, "Adquisiciones · base según la regla general de devengo", null, cash.purchaseBase],
        ["Criterio de caja", purchaseTax, "Adquisiciones · cuota según la regla general de devengo", null, cash.purchaseTax],
      );
    }
    const prorrata = summary.prorrata;
    if (prorrata) {
      rows.push(
        ["Prorrata", null, `Prorrata provisional del año (${prorrata.provisionalPct} %)`, null, null],
        ["Prorrata", null, `Prorrata definitiva ${prorrata.confirmedPct === null ? "sin confirmar" : `confirmada (${prorrata.confirmedPct} %)`}${prorrata.computedPct === null ? "" : ` · calculada ${prorrata.computedPct} %`}`, null, null],
        ["Prorrata", null, "Total de operaciones del año", null, prorrata.totalOperations],
        ["Prorrata", null, "Operaciones con derecho a deducción", null, prorrata.deductibleOperations],
      );
      if (prorrata.regularizationAmount !== null) rows.push(["Prorrata", "44", "Regularización por la prorrata definitiva", null, prorrata.regularizationAmount]);
      if (prorrata.investmentRegularizationAmount !== null) rows.push(["Prorrata", "43", "Regularización de bienes de inversión", null, prorrata.investmentRegularizationAmount]);
    }
    for (const bucket of summary.buckets) rows.push(["IVA repercutido", `${bucket.rate}%`, "Base", null, bucket.base], ["IVA repercutido", `${bucket.rate}%`, "Cuota", null, bucket.tax]);
    for (const bucket of summary.inputBuckets) rows.push(["IVA soportado", `${bucket.rate}%`, "Base", null, bucket.base], ["IVA soportado", `${bucket.rate}%`, "Cuota", null, bucket.tax]);
    for (const bucket of summary.withholdingBuckets) rows.push(["Retenciones", `${bucket.rate}%`, "Base", null, bucket.base], ["Retenciones", `${bucket.rate}%`, "Retención", null, bucket.tax]);
    for (const operation of summary.thirdPartyOperations ?? []) {
      const kind = operation.type === "customer" ? "Cliente" : "Proveedor";
      // Marcas del 347: cada combinación va en un registro aparte del mismo tercero.
      const marks = [
        operation.flags?.lease ? "arrendamiento de local" : null,
        operation.flags?.cashAccounting ? "criterio de caja" : null,
        operation.flags?.reverseCharge ? "inversión del sujeto pasivo" : null,
      ].filter((mark): mark is string => mark !== null);
      const label = marks.length > 0 ? `${operation.name} [${marks.join(", ")}]` : operation.name;
      rows.push(["Operaciones 347", kind, label, operation.taxId, operation.amount]);
      operation.quarters.forEach((amount, index) => rows.push(["Operaciones 347 por trimestre", `${kind} · ${index + 1}T`, label, operation.taxId, amount]));
      if (operation.cashAmount !== undefined) rows.push(["Operaciones 347 en metálico", kind, label, operation.taxId, operation.cashAmount]);
      if (operation.cashAccrualAmount !== undefined) rows.push(["Operaciones 347 devengadas por criterio de caja", kind, label, operation.taxId, operation.cashAccrualAmount]);
    }
  }
  return rows;
}

export function fiscalSummaryToCsv(summary: SpanishFiscalSummary) {
  return `﻿${fiscalSummaryToCsvCells(summary).map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
}
