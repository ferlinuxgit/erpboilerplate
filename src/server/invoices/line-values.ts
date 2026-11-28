import { calculateInvoiceTotals, type InvoiceCalculationLine, type InvoiceCalculationOptions } from "@/lib/invoice-totals";

export type InvoiceLineInput = InvoiceCalculationLine & {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number | null;
  retentionRate?: number | null;
  taxIds?: string[];
  lineTotal?: number | null;
};

export function buildInvoiceLineInsertValues(
  invoiceId: string,
  lines: InvoiceLineInput[],
  lineIds?: string[],
  options: InvoiceCalculationOptions = {},
) {
  const totals = calculateInvoiceTotals(lines, options);

  return lines.map((line, index) => ({
    ...(lineIds?.[index] ? { id: lineIds[index] } : {}),
    invoiceId,
    ...(line.itemId !== undefined ? { itemId: line.itemId } : {}),
    description: line.description.trim(),
    quantity: line.quantity.toFixed(3),
    unitPrice: line.unitPrice.toFixed(2),
    // Suplido: no es base. Se guarda con descuento 100 para que una lectura que no conozca
    // `isDisbursement` y calcule cantidad × precio × (1 − dto.) obtenga base 0 (su importe va en `lineTotal`).
    ...(line.isDisbursement
      ? { discountPct: "100.000", isDisbursement: true }
      : line.discountPct !== undefined && line.discountPct !== null ? { discountPct: line.discountPct.toFixed(3) } : {}),
    ...(line.isGlobalDiscount ? { isGlobalDiscount: true } : {}),
    ...(line.advanceInvoiceId ? { advanceInvoiceId: line.advanceInvoiceId } : {}),
    taxRate: totals.lines[index]!.taxes
      .filter((selectedTax) => selectedTax.operation === "ADD")
      .reduce((sum, selectedTax) => sum + selectedTax.rate, 0)
      .toFixed(3),
    retentionRate: totals.lines[index]!.taxes
      .filter((selectedTax) => selectedTax.operation === "SUBTRACT")
      .reduce((sum, selectedTax) => sum + selectedTax.rate, 0)
      .toFixed(3),
    lineTotal: (totals.lines[index]?.lineTotal ?? 0).toFixed(2),
  }));
}

export function buildInvoiceLineTaxInsertValues(lineIds: string[], lines: InvoiceLineInput[], options: InvoiceCalculationOptions = {}) {
  const totals = calculateInvoiceTotals(lines, options);

  return totals.lines.flatMap((lineTotal, lineIndex) =>
    lineTotal.taxes.map((selectedTax) => ({
      invoiceLineId: lineIds[lineIndex]!,
      taxId: selectedTax.id ?? null,
      name: selectedTax.name?.trim() || (selectedTax.operation === "SUBTRACT" ? "Retención" : "Impuesto"),
      rate: selectedTax.rate.toFixed(3),
      kind: selectedTax.kind?.trim() || (selectedTax.operation === "SUBTRACT" ? "WITHHOLDING" : "OTHER"),
      operation: selectedTax.operation,
      baseAmount: selectedTax.baseAmount.toFixed(2),
      amount: selectedTax.amount.toFixed(2),
    })),
  );
}
