import {
  amountToCents,
  bucketKey,
  centsToNumber,
  computeEngineDocument,
  legacyLineTaxes,
  lineBaseCents,
  roundHalfAwayFromZero,
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
  /**
   * Suplido (art. 78.Tres.3.º de la Ley 37/1992): pago hecho en nombre y por cuenta del cliente.
   * No es base imponible ni lleva IVA ni retención; se suma aparte al total a pagar.
   */
  isDisbursement?: boolean | null;
  /** Línea generada por el descuento global de la factura (negativa; ver `buildGlobalDiscountLines`). */
  isGlobalDiscount?: boolean | null;
  /** Línea que descuenta un anticipo ya facturado (negativa): id de la factura de anticipo. */
  advanceInvoiceId?: string | null;
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
  /** Solo en las líneas de suplido: su importe. */
  disbursementAmount?: number;
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
  /**
   * Total a pagar: bases + cuotas − retenciones + suplidos. El «importe total de la factura» a
   * efectos fiscales (el de VERI*FACTU y el QR) es `subtotal + taxAmount`, sin suplidos.
   */
  totalAmount: number;
  /** Suplidos de la factura (0 si no hay): suman al total a pagar, no a la base. */
  disbursementAmount: number;
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
      ...(line.isDisbursement ? { disbursement: true } : {}),
      // El descuento global y el anticipo descontado restan también en una factura ordinaria.
      ...(isDeductionLine(line) ? { allowNegative: true } : {}),
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
      ...(line.disbursementCents !== undefined ? { disbursementAmount: centsToNumber(line.disbursementCents) } : {}),
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
    disbursementAmount: centsToNumber(result.disbursementCents),
  };
}

/** Línea que resta en una factura ordinaria: descuento global o anticipo descontado. */
export function isDeductionLine(line: Pick<InvoiceCalculationLine, "isGlobalDiscount" | "advanceInvoiceId">) {
  return Boolean(line.isGlobalDiscount || line.advanceInvoiceId);
}

/** Línea corriente: ni suplido, ni descuento global, ni anticipo descontado. */
export function isOrdinaryLine(line: Pick<InvoiceCalculationLine, "isDisbursement" | "isGlobalDiscount" | "advanceInvoiceId">) {
  return !line.isDisbursement && !isDeductionLine(line);
}

// ---------------------------------------------------------------------------------------------
// Descuento global de la factura (también el de pronto pago).
// ---------------------------------------------------------------------------------------------

export type GlobalDiscount = {
  /** Porcentaje sobre la base de las líneas corrientes. Si es mayor que 0 manda sobre `amount`. */
  pct?: number | null;
  /** Importe fijo (sin impuestos) que se reparte entre las bases de cada tipo en proporción. */
  amount?: number | null;
};

export type GlobalDiscountLine = InvoiceCalculationLine & { description: string; quantity: number; unitPrice: number; isGlobalDiscount: true };

export function hasGlobalDiscount(discount: GlobalDiscount | null | undefined) {
  return number(discount?.pct) > 0 || number(discount?.amount) > 0;
}

function percentLabel(value: number) {
  return String(Number(value.toFixed(3))).replace(".", ",");
}

/** Combinación de impuestos de una línea (tipo, recargo, retención): el descuento global se reparte por ella. */
export function lineTaxGroupKey(line: Pick<InvoiceCalculationLine, "taxes" | "taxRate" | "retentionRate">): string {
  const taxes: EngineTax[] = line.taxes !== undefined && line.taxes !== null ? line.taxes : legacyLineTaxes(line);
  return taxes.map((selectedTax) => bucketKey(selectedTax)).sort().join("+");
}

/** Reparto proporcional exacto en céntimos (método del resto mayor): la suma es siempre `total`. */
export function apportionCents(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / weightSum);
  const shares = exact.map((value) => Math.floor(value + 1e-9));
  let remaining = total - shares.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - shares[index]! }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const entry of order) {
    if (remaining <= 0) break;
    shares[entry.index]! += 1;
    remaining -= 1;
  }
  return shares;
}

/**
 * Líneas (negativas) que materializan el descuento global de una factura.
 *
 * Art. 78.Tres.2.º de la Ley 37/1992: los descuentos concedidos previa o simultáneamente a la
 * operación no forman parte de la base imponible. El descuento se reparte entre las bases de cada
 * combinación de impuestos (tipo de IVA, recargo, retención) en proporción a su importe y se guarda
 * como una línea negativa por combinación, con sus mismos impuestos: así la base y la cuota de cada
 * tipo bajan en la misma proporción y todo lo que lee las líneas (asiento, VERI*FACTU, modelos,
 * libros) ve ya la base neta, sin necesidad de conocer el descuento.
 *
 * Solo descuenta las líneas corrientes: los suplidos no son precio y los anticipos se restan después.
 * Devuelve [] si no hay descuento o no hay base positiva que descontar.
 */
export function buildGlobalDiscountLines<T extends InvoiceCalculationLine>(lines: T[], discount: GlobalDiscount | null | undefined): GlobalDiscountLine[] {
  if (!hasGlobalDiscount(discount)) return [];
  const pct = Math.min(number(discount?.pct), 100);
  const groups = new Map<string, { sample: T; baseCents: number }>();
  for (const line of lines) {
    if (!isOrdinaryLine(line) || !line.description?.trim()) continue;
    const key = lineTaxGroupKey(line);
    const baseCents = lineBaseCents({ quantity: number(line.quantity), unitPrice: number(line.unitPrice), discountPct: line.discountPct });
    const group = groups.get(key);
    if (group) group.baseCents += baseCents;
    else groups.set(key, { sample: line, baseCents });
  }
  const entries = [...groups.values()].filter((group) => group.baseCents > 0);
  if (entries.length === 0) return [];
  const totalBase = entries.reduce((sum, group) => sum + group.baseCents, 0);
  const shares = pct > 0
    ? entries.map((group) => roundHalfAwayFromZero((group.baseCents * pct) / 100))
    : apportionCents(Math.min(amountToCents(discount?.amount), totalBase), entries.map((group) => group.baseCents));
  const label = pct > 0 ? `Descuento ${percentLabel(pct)} %` : "Descuento";
  return entries.flatMap((group, index) => {
    const share = shares[index]!;
    if (share <= 0) return [];
    const { sample } = group;
    return [{
      description: label,
      quantity: 1,
      unitPrice: -centsToNumber(share),
      discountPct: 0,
      ...(sample.taxes !== undefined && sample.taxes !== null ? { taxes: sample.taxes } : { taxRate: sample.taxRate ?? 0, retentionRate: sample.retentionRate ?? 0 }),
      isGlobalDiscount: true as const,
    }];
  });
}

/** Quita las líneas de descuento global (para regenerarlas o para editar la factura). */
export function withoutGlobalDiscountLines<T extends Pick<InvoiceCalculationLine, "isGlobalDiscount">>(lines: T[]): T[] {
  return lines.filter((line) => !line.isGlobalDiscount);
}

/** Líneas definitivas de una factura: las del usuario más las del descuento global recalculadas. */
export function applyGlobalDiscount<T extends InvoiceCalculationLine>(lines: T[], discount: GlobalDiscount | null | undefined): Array<T | GlobalDiscountLine> {
  const own = withoutGlobalDiscountLines(lines);
  return [...own, ...buildGlobalDiscountLines(own, discount)];
}

export type InvoiceAmountsSummary = {
  /** Base de las líneas corrientes antes del descuento global y de los anticipos. */
  grossSubtotal: number;
  /** Descuento global (en positivo). */
  globalDiscountAmount: number;
  /** Base de los anticipos descontados (en positivo). */
  advanceDeductedAmount: number;
  /** Base imponible. */
  subtotal: number;
  /** Importe total de la factura a efectos fiscales: base + cuotas (sin retención ni suplidos). */
  invoiceTotal: number;
  disbursementAmount: number;
  retentionAmount: number;
  /** Total a pagar. */
  totalAmount: number;
};

/** Resumen para el PDF, el ticket y la ficha: del importe bruto al total a pagar. */
export function summarizeInvoiceAmounts(lines: InvoiceCalculationLine[], totals: InvoiceTotals): InvoiceAmountsSummary {
  let discountCents = 0;
  let advanceCents = 0;
  lines.forEach((line, index) => {
    const baseCents = amountToCents(totals.lines[index]?.subtotal ?? 0);
    if (line.isGlobalDiscount) discountCents -= baseCents;
    else if (line.advanceInvoiceId) advanceCents -= baseCents;
  });
  const subtotalCents = amountToCents(totals.subtotal);
  return {
    grossSubtotal: centsToNumber(subtotalCents + discountCents + advanceCents),
    globalDiscountAmount: centsToNumber(discountCents),
    advanceDeductedAmount: centsToNumber(advanceCents),
    subtotal: totals.subtotal,
    invoiceTotal: centsToNumber(subtotalCents + amountToCents(totals.taxAmount)),
    disbursementAmount: totals.disbursementAmount,
    retentionAmount: totals.retentionAmount,
    totalAmount: totals.totalAmount,
  };
}
