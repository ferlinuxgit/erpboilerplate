import {
  centsToNumber,
  computeEngineDocument,
  legacyLineTaxes,
  type EngineOptions,
  type EngineTax,
  type TaxOperation,
} from "@/server/taxation/engine";

/**
 * Adaptador de importes en euros sobre el motor fiscal único (`@/server/taxation/engine`).
 * Mantiene la firma histórica usada por formularios, PDF y servicios.
 */

export type { TaxOperation };

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

export type InvoiceTaxBucket = {
  name: string | null;
  kind: string | null;
  rate: number;
  operation: TaxOperation;
  baseAmount: number;
  amount: number;
};

export type InvoiceTotals = {
  lines: InvoiceLineTotal[];
  /** Desglose por tipo impositivo (base y cuota por bucket, como exige la factura española). */
  taxBuckets: InvoiceTaxBucket[];
  subtotal: number;
  taxAmount: number;
  retentionAmount: number;
  totalAmount: number;
};

export type InvoiceCalculationOptions = EngineOptions;

function number(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function calculateInvoiceTotals(lines: InvoiceCalculationLine[], options: InvoiceCalculationOptions = {}): InvoiceTotals {
  const engineLines = lines.map((line) => {
    const hasDescription = Boolean(line.description?.trim());
    const selectedTaxes: EngineTax[] = hasDescription && line.taxes !== undefined && line.taxes !== null
      ? line.taxes
      : legacyLineTaxes(line);
    return {
      quantity: hasDescription ? number(line.quantity) : 0,
      unitPrice: hasDescription ? number(line.unitPrice) : 0,
      discountPct: hasDescription ? line.discountPct : 0,
      taxes: selectedTaxes,
    };
  });
  const result = computeEngineDocument(engineLines, options);

  return {
    lines: result.lines.map((line) => ({
      subtotal: centsToNumber(line.baseCents),
      taxAmount: centsToNumber(line.taxCents),
      retentionAmount: centsToNumber(line.retentionCents),
      lineTotal: centsToNumber(line.totalCents),
      taxes: line.taxes.map(({ baseCents, amountCents, ...selectedTax }) => ({
        ...selectedTax,
        baseAmount: centsToNumber(baseCents),
        amount: centsToNumber(amountCents),
      })),
    })),
    taxBuckets: result.buckets.map((bucket) => ({
      name: bucket.name,
      kind: bucket.kind,
      rate: bucket.rate,
      operation: bucket.operation,
      baseAmount: centsToNumber(bucket.baseCents),
      amount: centsToNumber(bucket.amountCents),
    })),
    subtotal: centsToNumber(result.subtotalCents),
    taxAmount: centsToNumber(result.taxCents),
    retentionAmount: centsToNumber(result.retentionCents),
    totalAmount: centsToNumber(result.totalCents),
  };
}
