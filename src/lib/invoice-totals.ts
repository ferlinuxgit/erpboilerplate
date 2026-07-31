export type TaxOperation = "ADD" | "SUBTRACT";

export type InvoiceCalculationTax = {
  id?: string | null;
  name?: string | null;
  rate: number;
  kind?: string | null;
  operation: TaxOperation;
};

export type InvoiceCalculationLine = {
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  discountPct?: number | null;
  taxRate?: number | null;
  retentionRate?: number | null;
  taxes?: InvoiceCalculationTax[] | null;
};

export type InvoiceLineTaxTotal = InvoiceCalculationTax & {
  baseAmount: number;
  amount: number;
};

export type InvoiceLineTotal = {
  subtotal: number;
  taxAmount: number;
  retentionAmount: number;
  lineTotal: number;
  taxes: InvoiceLineTaxTotal[];
};

export type InvoiceTotals = {
  lines: InvoiceLineTotal[];
  subtotal: number;
  taxAmount: number;
  retentionAmount: number;
  totalAmount: number;
};

function normalizeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizePercentage(value: number | null | undefined) {
  return Math.min(normalizeNumber(value), 100);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateInvoiceTotals(lines: InvoiceCalculationLine[]): InvoiceTotals {
  const lineTotals = lines.map((line) => {
    const hasDescription = Boolean(line.description?.trim());
    const quantity = hasDescription ? normalizeNumber(line.quantity) : 0;
    const unitPrice = hasDescription ? normalizeNumber(line.unitPrice) : 0;
    const discountPct = hasDescription ? normalizePercentage(line.discountPct) : 0;
    const grossSubtotal = roundMoney(quantity * unitPrice);
    const subtotal = roundMoney(grossSubtotal * (1 - discountPct / 100));
    const selectedTaxes = hasDescription && line.taxes !== undefined && line.taxes !== null
      ? line.taxes
      : [
          ...(normalizeNumber(line.taxRate) > 0
            ? [{ name: "IVA", rate: normalizeNumber(line.taxRate), kind: "VAT", operation: "ADD" as const }]
            : []),
          ...(normalizePercentage(line.retentionRate) > 0
            ? [{ name: "Retención", rate: normalizePercentage(line.retentionRate), kind: "WITHHOLDING", operation: "SUBTRACT" as const }]
            : []),
        ];
    const taxes = selectedTaxes.map((selectedTax) => ({
      ...selectedTax,
      rate: normalizeNumber(selectedTax.rate),
      baseAmount: subtotal,
      amount: roundMoney(subtotal * (normalizeNumber(selectedTax.rate) / 100)),
    }));
    const taxAmount = roundMoney(
      taxes.filter((selectedTax) => selectedTax.operation === "ADD").reduce((sum, selectedTax) => sum + selectedTax.amount, 0),
    );
    const retentionAmount = roundMoney(
      taxes.filter((selectedTax) => selectedTax.operation === "SUBTRACT").reduce((sum, selectedTax) => sum + selectedTax.amount, 0),
    );
    const lineTotal = roundMoney(subtotal + taxAmount - retentionAmount);

    return { subtotal, taxAmount, retentionAmount, lineTotal, taxes };
  });

  return {
    lines: lineTotals,
    subtotal: roundMoney(lineTotals.reduce((sum, line) => sum + line.subtotal, 0)),
    taxAmount: roundMoney(lineTotals.reduce((sum, line) => sum + line.taxAmount, 0)),
    retentionAmount: roundMoney(lineTotals.reduce((sum, line) => sum + line.retentionAmount, 0)),
    totalAmount: roundMoney(lineTotals.reduce((sum, line) => sum + line.lineTotal, 0)),
  };
}
