import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

/**
 * CSV de un modelo fiscal (mismo contenido que el PDF): separador ";", BOM UTF-8 y coma decimal,
 * para que Excel en español lo abra en columnas. Protege frente a inyección de fórmulas.
 */

function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? value.toFixed(2).replace(".", ",") : String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function fiscalSummaryToCsvRows(summary: SpanishFiscalSummary): Array<Array<string | number | null>> {
  const rows: Array<Array<string | number | null>> = [["Sección", "Casilla / clave", "Concepto", "NIF", "Importe"]];
  rows.push(["Modelo", summary.code, `${summary.modelName} · ${summary.periodLabel}`, null, summary.amountDue]);
  if (summary.modelo130) {
    for (const box of summary.modelo130.boxes) rows.push(["Modelo 130", box.box, box.label, null, box.amount]);
  } else if (summary.modelo349) {
    for (const operator of summary.modelo349.operators) rows.push(["Operadores 349", operator.key, operator.name, operator.taxId, operator.amount]);
    for (const operator of summary.modelo349.rectifications) rows.push(["Rectificaciones 349", operator.key, `${operator.name} (periodo ${operator.originalPeriod})`, operator.taxId, operator.amount]);
  } else {
    if (summary.code === "303" || summary.code === "390") {
      for (const box of summary.modelo303Boxes) rows.push(["Casillas 303", box.box, box.label, null, box.amount]);
    }
    for (const bucket of summary.buckets) rows.push(["IVA repercutido", `${bucket.rate}%`, "Base", null, bucket.base], ["IVA repercutido", `${bucket.rate}%`, "Cuota", null, bucket.tax]);
    for (const bucket of summary.inputBuckets) rows.push(["IVA soportado", `${bucket.rate}%`, "Base", null, bucket.base], ["IVA soportado", `${bucket.rate}%`, "Cuota", null, bucket.tax]);
    for (const bucket of summary.withholdingBuckets) rows.push(["Retenciones", `${bucket.rate}%`, "Base", null, bucket.base], ["Retenciones", `${bucket.rate}%`, "Retención", null, bucket.tax]);
    for (const operation of summary.thirdPartyOperations ?? []) rows.push(["Operaciones 347", operation.type === "customer" ? "Cliente" : "Proveedor", operation.name, operation.taxId, operation.amount]);
  }
  for (const document of summary.sourceDocuments.salesInvoices) rows.push(["Facturas emitidas", document.issueDate.slice(0, 10), document.number, null, document.taxBase]);
  for (const document of summary.sourceDocuments.supplierInvoices) rows.push(["Facturas recibidas", document.issueDate.slice(0, 10), document.number, null, document.taxBase]);
  return rows;
}

export function fiscalSummaryToCsv(summary: SpanishFiscalSummary) {
  return `\uFEFF${fiscalSummaryToCsvRows(summary).map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
}
