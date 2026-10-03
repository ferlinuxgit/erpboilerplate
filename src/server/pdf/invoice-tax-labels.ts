import type { InvoiceLineTaxTotal, InvoiceTaxBucket } from "@/lib/invoice-totals";

/**
 * Presentación de impuestos en el PDF de la factura, como las facturas españolas habituales:
 * cada línea muestra su base y los tipos (IVA, IRPF); las cuotas solo aparecen en los totales,
 * una fila por impuesto y tipo con su base.
 */

type TaxLike = Pick<InvoiceLineTaxTotal, "name" | "kind" | "rate" | "operation">;

/** 21 → «21 %», 5.2 → «5,2 %» (formato es-ES, sin ceros sobrantes). */
export function formatRate(rate: number) {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(rate)} %`;
}

function kindOf(tax: TaxLike) {
  const kind = (tax.kind ?? "").toUpperCase();
  if (kind) return kind;
  return tax.operation === "SUBTRACT" ? "WITHHOLDING" : "VAT";
}

/** Etiqueta del impuesto en los totales: «IVA 21 %», «Recargo de equivalencia 5,2 %», «Retención IRPF 15 %». */
export function taxTotalLabel(tax: TaxLike) {
  const kind = kindOf(tax);
  if (kind === "VAT") return `IVA ${formatRate(tax.rate)}`;
  if (kind === "SURCHARGE") return `Recargo de equivalencia ${formatRate(tax.rate)}`;
  if (kind === "WITHHOLDING") {
    // «Retención alquiler 19%» conserva su concepto; el resto son retenciones de IRPF.
    return /alquiler|arrendamiento/i.test(tax.name ?? "") ? `Retención alquiler ${formatRate(tax.rate)}` : `Retención IRPF ${formatRate(tax.rate)}`;
  }
  return tax.name?.trim() || `Impuesto ${formatRate(tax.rate)}`;
}

/** Columnas de impuestos de una línea: IVA (con recargo si lo hay) y retención. «—» si no lleva. */
export function lineTaxColumns(taxes: TaxLike[]) {
  const added = taxes.filter((tax) => tax.operation !== "SUBTRACT");
  const vat = added.filter((tax) => kindOf(tax) === "VAT").map((tax) => formatRate(tax.rate));
  const others = added.filter((tax) => kindOf(tax) !== "VAT").map((tax) => (kindOf(tax) === "SURCHARGE" ? `RE ${formatRate(tax.rate)}` : taxTotalLabel(tax)));
  const withholding = taxes.filter((tax) => tax.operation === "SUBTRACT").map((tax) => formatRate(tax.rate));
  return {
    vat: [...vat, ...others].join("\n") || "—",
    withholding: withholding.join("\n") || "—",
    hasWithholding: withholding.length > 0,
  };
}

/** Filas de impuestos de los totales: IVA y recargos primero, retenciones al final. */
export function taxTotalRows(buckets: InvoiceTaxBucket[], formatMoney: (value: number) => string) {
  return [...buckets]
    .sort((left, right) => (left.operation === right.operation ? right.rate - left.rate : left.operation === "SUBTRACT" ? 1 : -1))
    .map((bucket) => ({
      label: taxTotalLabel(bucket),
      base: formatMoney(bucket.baseAmount),
      amount: formatMoney(bucket.amount),
      operation: bucket.operation,
    }));
}
