/**
 * Motor fiscal único (céntimos enteros) para facturas emitidas, documentos de venta y facturas
 * recibidas. Es código puro (sin dependencias de servidor): se usa también en formularios cliente.
 *
 * Práctica española (art. 10 RD 1619/2012 y criterio AEAT):
 * - La base de cada línea se redondea a céntimos (cantidad × precio × (1 − dto.)).
 * - La cuota de cada impuesto se calcula por tipo impositivo sobre la suma de bases de ese tipo
 *   ("bucket"), no sumando cuotas redondeadas línea a línea.
 * - Total = Σ bases + Σ cuotas repercutidas − Σ retenciones.
 *
 * Las cuotas por línea también se devuelven (para mostrarlas y guardarlas en `invoice_line_tax`),
 * pero los totales del documento salen siempre de los buckets.
 */

export type TaxOperation = "ADD" | "SUBTRACT";

export type EngineTax = {
  id?: string | null;
  name?: string | null;
  rate: number;
  kind?: string | null;
  operation: TaxOperation;
};

export type EngineLine = {
  quantity: number;
  unitPrice: number;
  discountPct?: number | null;
  taxes: EngineTax[];
};

export type EngineOptions = {
  /** Permite cantidades o precios negativos (facturas rectificativas por diferencias). */
  allowNegative?: boolean;
};

export type EngineLineTax = EngineTax & { baseCents: number; amountCents: number };

export type EngineLineResult = {
  baseCents: number;
  taxCents: number;
  retentionCents: number;
  totalCents: number;
  taxes: EngineLineTax[];
};

export type EngineTaxBucket = {
  key: string;
  name: string | null;
  kind: string | null;
  rate: number;
  operation: TaxOperation;
  baseCents: number;
  amountCents: number;
};

export type EngineDocumentResult = {
  lines: EngineLineResult[];
  buckets: EngineTaxBucket[];
  subtotalCents: number;
  taxCents: number;
  retentionCents: number;
  totalCents: number;
};

/** Redondeo "half away from zero" robusto frente a errores binarios (1.005 × 100 = 100.4999…). */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = Number(Math.abs(value).toFixed(6));
  const rounded = Math.round(scaled);
  return value < 0 ? -rounded : rounded;
}

export function amountToCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const amount = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  return Number.isFinite(amount) ? roundHalfAwayFromZero(amount * 100) : 0;
}

export function centsToNumber(cents: number): number {
  return Math.trunc(cents) / 100;
}

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampPct(value: number | null | undefined) {
  return Math.min(Math.max(finite(value), 0), 100);
}

function normalizeRate(value: number | null | undefined) {
  return Math.max(finite(value), 0);
}

/** Base de una línea en céntimos, con un único redondeo final. */
export function lineBaseCents(line: Pick<EngineLine, "quantity" | "unitPrice" | "discountPct">, options: EngineOptions = {}): number {
  const quantity = options.allowNegative ? finite(line.quantity) : Math.max(finite(line.quantity), 0);
  const unitPrice = options.allowNegative ? finite(line.unitPrice) : Math.max(finite(line.unitPrice), 0);
  const discountPct = clampPct(line.discountPct);
  return roundHalfAwayFromZero(quantity * unitPrice * (100 - discountPct));
}

/** Cuota de un impuesto sobre una base en céntimos. */
export function taxOnBaseCents(baseCents: number, rate: number): number {
  return roundHalfAwayFromZero((baseCents * normalizeRate(rate)) / 100);
}

export function bucketKey(tax: Pick<EngineTax, "operation" | "kind" | "rate">) {
  return `${tax.operation}|${(tax.kind ?? "").toUpperCase()}|${normalizeRate(tax.rate)}`;
}

export function computeEngineLine(line: EngineLine, options: EngineOptions = {}): EngineLineResult {
  const baseCents = lineBaseCents(line, options);
  const taxes = line.taxes.map((selectedTax) => ({
    ...selectedTax,
    rate: normalizeRate(selectedTax.rate),
    baseCents,
    amountCents: taxOnBaseCents(baseCents, selectedTax.rate),
  }));
  const taxCents = taxes.filter((entry) => entry.operation === "ADD").reduce((sum, entry) => sum + entry.amountCents, 0);
  const retentionCents = taxes.filter((entry) => entry.operation === "SUBTRACT").reduce((sum, entry) => sum + entry.amountCents, 0);
  return { baseCents, taxCents, retentionCents, totalCents: baseCents + taxCents - retentionCents, taxes };
}

/** Totales del documento: bases por línea, cuotas por bucket (tipo + clase + operación). */
export function computeEngineDocument(lines: EngineLine[], options: EngineOptions = {}): EngineDocumentResult {
  const lineResults = lines.map((line) => computeEngineLine(line, options));
  const buckets = new Map<string, EngineTaxBucket>();
  for (const line of lineResults) {
    for (const selectedTax of line.taxes) {
      const key = bucketKey(selectedTax);
      const bucket = buckets.get(key) ?? {
        key,
        name: selectedTax.name ?? null,
        kind: selectedTax.kind ?? null,
        rate: selectedTax.rate,
        operation: selectedTax.operation,
        baseCents: 0,
        amountCents: 0,
      };
      bucket.baseCents += line.baseCents;
      buckets.set(key, bucket);
    }
  }
  const bucketList = [...buckets.values()].map((bucket) => ({ ...bucket, amountCents: taxOnBaseCents(bucket.baseCents, bucket.rate) }));
  const subtotalCents = lineResults.reduce((sum, line) => sum + line.baseCents, 0);
  const taxCents = bucketList.filter((bucket) => bucket.operation === "ADD").reduce((sum, bucket) => sum + bucket.amountCents, 0);
  const retentionCents = bucketList.filter((bucket) => bucket.operation === "SUBTRACT").reduce((sum, bucket) => sum + bucket.amountCents, 0);
  return {
    lines: lineResults,
    buckets: bucketList,
    subtotalCents,
    taxCents,
    retentionCents,
    totalCents: subtotalCents + taxCents - retentionCents,
  };
}

/** Impuestos implícitos de una línea "legacy" (tipo de IVA + % de retención sin impuestos configurados). */
export function legacyLineTaxes(line: { taxRate?: number | null; retentionRate?: number | null }): EngineTax[] {
  const taxRate = normalizeRate(line.taxRate);
  const retentionRate = clampPct(line.retentionRate);
  return [
    ...(taxRate > 0 ? [{ name: "IVA", rate: taxRate, kind: "VAT", operation: "ADD" as const }] : []),
    ...(retentionRate > 0 ? [{ name: "Retención", rate: retentionRate, kind: "WITHHOLDING", operation: "SUBTRACT" as const }] : []),
  ];
}

// ---------------------------------------------------------------------------------------------
// API simple (importes en euros) usada por presupuestos, pedidos y facturas recibidas.
// ---------------------------------------------------------------------------------------------

type LineInput = {
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRate?: number;
  retentionRate?: number;
};

type ComputedLine = {
  base: number;
  taxAmount: number;
  retentionAmount: number;
  total: number;
};

export function computeLineAmounts(input: LineInput): ComputedLine {
  const result = computeEngineLine({ ...input, taxes: legacyLineTaxes(input) });
  return {
    base: centsToNumber(result.baseCents),
    taxAmount: centsToNumber(result.taxCents),
    retentionAmount: centsToNumber(result.retentionCents),
    total: centsToNumber(result.totalCents),
  };
}

export function computeDocumentTotals(lines: LineInput[]) {
  const result = computeEngineDocument(lines.map((line) => ({ ...line, taxes: legacyLineTaxes(line) })));
  return {
    subtotal: centsToNumber(result.subtotalCents),
    taxAmount: centsToNumber(result.taxCents),
    retentionAmount: centsToNumber(result.retentionCents),
    totalAmount: centsToNumber(result.totalCents),
  };
}
