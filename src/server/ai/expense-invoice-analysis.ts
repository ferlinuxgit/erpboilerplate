import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { amountToCents, centsToNumber, computeEngineDocument, legacyLineTaxes, roundHalfAwayFromZero } from "@/server/taxation/engine";

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

const taxSchema = z.object({
  tax_type: z.enum(["VAT", "IGIC", "IPSI", "withholding", "surcharge", "other"]),
  tax_name: nullableString,
  rate: nullableNumber,
  base_amount: nullableNumber,
  tax_amount: nullableNumber,
  deductible_pct: nullableNumber,
});

const lineSchema = z.object({
  line_number: z.number().int(),
  description: z.string(),
  item_code: nullableString,
  quantity: nullableNumber,
  unit_of_measure: nullableString,
  unit_price: nullableNumber,
  discount_pct: nullableNumber,
  discount_amount: nullableNumber,
  subtotal_amount: nullableNumber,
  tax_rate: nullableNumber,
  tax_amount: nullableNumber,
  tax_deductible_pct: nullableNumber,
  retention_rate: nullableNumber,
  retention_amount: nullableNumber,
  total_amount: nullableNumber,
  suggested_expense_account_code: nullableString,
  cost_center: nullableString,
  project: nullableString,
  department: nullableString,
});

export const expenseInvoiceAiAnalysisSchema = z.object({
  supplier_name: nullableString,
  supplier_commercial_name: nullableString,
  supplier_tax_id: nullableString,
  supplier_vat_number: nullableString,
  supplier_email: nullableString,
  supplier_phone: nullableString,
  supplier_website: nullableString,
  supplier_address: nullableString,
  supplier_postal_code: nullableString,
  supplier_city: nullableString,
  supplier_province: nullableString,
  supplier_country_code: nullableString,
  customer_name: nullableString,
  customer_tax_id: nullableString,
  customer_address: nullableString,
  invoice_number: nullableString,
  invoice_series: nullableString,
  invoice_issue_date: nullableString,
  invoice_operation_date: nullableString,
  invoice_due_date: nullableString,
  invoice_received_date: nullableString,
  currency_code: nullableString,
  exchange_rate: nullableNumber,
  payment_method: z.enum(["bank_transfer", "direct_debit", "card", "cash", "cheque", "other", "unknown"]),
  payment_terms: nullableString,
  supplier_iban: nullableString,
  supplier_bic: nullableString,
  purchase_order_number: nullableString,
  delivery_note_number: nullableString,
  contract_number: nullableString,
  invoice_reference: nullableString,
  description: nullableString,
  expense_category: z.enum([
    "fuel",
    "utilities",
    "rent",
    "software",
    "professional_services",
    "insurance",
    "travel",
    "office_supplies",
    "telecom",
    "maintenance",
    "other",
    "unknown",
  ]),
  suggested_expense_account_code: nullableString,
  is_purchase_order_related: z.boolean(),
  is_recurring: z.boolean(),
  recurrence_periodicity: z.enum(["monthly", "quarterly", "yearly", "unknown"]).nullable(),
  subtotal_amount: nullableNumber,
  discount_amount: nullableNumber,
  shipping_amount: nullableNumber,
  additional_charges: z.array(z.object({ description: z.string(), amount: z.number(), tax_rate: nullableNumber })),
  tax_amount: nullableNumber,
  retention_amount: nullableNumber,
  surcharge_amount: nullableNumber,
  rounding_amount: nullableNumber,
  total_amount: nullableNumber,
  paid_amount: nullableNumber,
  outstanding_amount: nullableNumber,
  taxes: z.array(taxSchema),
  lines: z.array(lineSchema),
  validation_totals_match: z.boolean(),
  validation_taxes_match: z.boolean(),
  validation_supplier_tax_id_valid: z.boolean(),
  possible_duplicate: z.boolean(),
  duplicate_reason: nullableString,
  warnings: z.array(z.string()),
  blocking_errors: z.array(z.string()),
  confidence_overall: z.number().min(0).max(1),
  confidence_supplier: z.number().min(0).max(1),
  confidence_supplier_tax_id: z.number().min(0).max(1),
  confidence_invoice_number: z.number().min(0).max(1),
  confidence_dates: z.number().min(0).max(1),
  confidence_amounts: z.number().min(0).max(1),
  confidence_lines: z.number().min(0).max(1),
  confidence_taxes: z.number().min(0).max(1),
});

export type ExpenseInvoiceAiAnalysis = z.infer<typeof expenseInvoiceAiAnalysisSchema>;

export type ExpenseInvoiceAiDraft = {
  supplierName?: string;
  supplierTaxId?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  supplierPostalCode?: string;
  supplierCity?: string;
  supplierProvince?: string;
  supplierCountryCode?: string;
  supplierDocumentNumber?: string;
  currencyCode?: string;
  issueDate?: string;
  dueDate?: string;
  subtotalAmount?: number;
  taxAmount?: number;
  retentionAmount?: number;
  totalAmount?: number;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    taxDeductiblePct: number;
    retentionRate: number;
    suggestedExpenseAccountCode?: string;
  }>;
  /** Bases por tipo de IVA del pie de la factura, solo si cuadran con el total. */
  taxSummary?: Array<{ taxRate: number; base: number; taxDeductiblePct: number }>;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

function isoDateOrUndefined(value: string | null) {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  // Fechas imposibles (2026-02-31, mes 13) se descartan en vez de saltar a otro mes.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function normalizedTaxId(value: string | null | undefined) {
  const normalized = (value ?? "").toUpperCase().replace(/[\s.-]/g, "");
  return normalized.startsWith("ES") && normalized.length > 9 ? normalized.slice(2) : normalized;
}

function confidenceLabel(score: number): "high" | "medium" | "low" {
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

/**
 * Una factura con cuenta de gasto o tipo de IVA supuestos (no leídos del documento) nunca
 * tiene confianza alta: así no entra en el registro en bloque sin revisión.
 */
function cappedConfidence(
  confidence: "high" | "medium" | "low",
  lines: ExpenseInvoiceAiDraft["lines"],
  analysis: ExpenseInvoiceAiAnalysis,
): "high" | "medium" | "low" {
  if (confidence !== "high") return confidence;
  const accountMissing = lines.some((line) => !line.suggestedExpenseAccountCode);
  const taxAssumed = analysis.lines.length > 0
    ? analysis.lines.some((line) => line.tax_rate === null) && analysis.taxes.every((tax) => tax.rate === null)
    : analysis.taxes.every((tax) => tax.rate === null);
  return accountMissing || taxAssumed ? "medium" : confidence;
}

function numberOrFallback(value: number | null, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

type AnalysisLine = ExpenseInvoiceAiAnalysis["lines"][number];
type DraftLine = ExpenseInvoiceAiDraft["lines"][number];

const round2 = (value: number) => centsToNumber(roundHalfAwayFromZero(value * 100));
const formatNumber = (value: number) => value.toLocaleString("es-ES", { maximumFractionDigits: 4 });

/** Filas de resumen que no son conceptos (subtotales, cuotas, "suma y sigue" entre páginas). */
const SUMMARY_ROW = /^(sub\s*total(es)?|total(es)?|bases? imponibles?|suma y sigue|suma anterior|importe total|cuotas?( de)? (iva|igic)|iva|igic|i\.v\.a\.?|irpf|retenci[oó]n|recargo de equivalencia)(\s|:|$|\d)/i;

const isAmount = (value: number | null): value is number => value !== null && Number.isFinite(value);

function lineHasAmount(line: AnalysisLine) {
  return isAmount(line.subtotal_amount) || isAmount(line.unit_price) || isAmount(line.total_amount);
}

/** Base neta de la línea (después de descuentos). */
function netLineBase(line: AnalysisLine, taxRate: number) {
  if (isAmount(line.subtotal_amount)) return line.subtotal_amount;
  if (isAmount(line.unit_price)) {
    const gross = line.unit_price * numberOrFallback(line.quantity, 1);
    if (isAmount(line.discount_amount)) return gross - line.discount_amount;
    if (isAmount(line.discount_pct)) return gross * (1 - line.discount_pct / 100);
    return gross;
  }
  // Solo hay importe con IVA: se quita el impuesto de la línea.
  return Number(line.total_amount) / (1 + taxRate / 100);
}

/**
 * Cantidad y precio que reproducen exactamente la base de la línea. El precio se guarda con 2
 * decimales: si cantidad × precio no da la base (3 × 0,333; 1,5 kg × 2,345 €), la línea pasa a
 * cantidad 1 con la base completa y la cantidad original queda en el concepto.
 */
function exactQuantityAndPrice(line: AnalysisLine, base: number, description: string) {
  const quantity = numberOrFallback(line.quantity, 1);
  if (quantity > 0) {
    const unitPrice = round2(base / quantity);
    if (amountToCents(unitPrice * quantity) === amountToCents(base)) return { quantity, unitPrice, description };
  }
  const detail = isAmount(line.unit_price) ? `${formatNumber(quantity)} × ${formatNumber(line.unit_price)}` : `cantidad ${formatNumber(quantity)}`;
  return { quantity: 1, unitPrice: round2(base), description: `${description} (${detail})` };
}

function draftTotalCents(lines: readonly Pick<DraftLine, "quantity" | "unitPrice" | "taxRate" | "retentionRate">[]) {
  return computeEngineDocument(lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, taxes: legacyLineTaxes(line) })), { allowNegative: true }).totalCents;
}

const STANDARD_RETENTION_RATES = [1, 2, 7, 15, 19];

/** % de retención cuando la factura solo trae el importe total retenido (no por línea). */
function documentRetentionRate(analysis: ExpenseInvoiceAiAnalysis, baseTotal: number) {
  const withholding = analysis.taxes.find((tax) => tax.tax_type === "withholding" && isAmount(tax.rate));
  if (withholding?.rate) return withholding.rate;
  if (!isAmount(analysis.retention_amount) || analysis.retention_amount <= 0 || baseTotal <= 0) return 0;
  const rate = (analysis.retention_amount / baseTotal) * 100;
  return STANDARD_RETENTION_RATES.find((candidate) => Math.abs(candidate - rate) < 0.05) ?? 0;
}

const VAT_TAX_TYPES = new Set(["VAT", "IGIC", "IPSI"]);
const SHIPPING_CHARGE = /porte|env[ií]o|freight|transporte|shipping/i;

/** Cargos del pie con importe: los leídos uno a uno y, si no están entre ellos, los portes. */
function footerCharges(analysis: ExpenseInvoiceAiAnalysis) {
  const charges = analysis.additional_charges
    .filter((charge) => isAmount(charge.amount) && charge.amount !== 0)
    .map((charge) => ({ description: charge.description.trim() || "Otros cargos", amount: charge.amount, taxRate: charge.tax_rate }));
  const shipping = analysis.shipping_amount ?? 0;
  if (shipping > 0 && !charges.some((charge) => SHIPPING_CHARGE.test(charge.description))) {
    charges.unshift({ description: "Portes", amount: shipping, taxRate: null });
  }
  return charges;
}

/**
 * Líneas de una factura con varios conceptos:
 * - las filas sin importe son la continuación del concepto anterior (descripciones en varias líneas);
 * - se descartan las filas de resumen (subtotal, IVA, total, "suma y sigue");
 * - los descuentos o abonos en línea negativa se restan de la línea del mismo IVA;
 * - portes y otros cargos del pie (manipulación, canon…) se añaden como líneas, y un descuento global
 *   se reparte, si así cuadra la base imponible.
 */
function buildDraftLines(analysis: ExpenseInvoiceAiAnalysis, defaults: { taxRate: number; deductiblePct: number }) {
  const warnings: string[] = [];
  const rows: Array<{ line: AnalysisLine; description: string }> = [];
  let pendingDescription = "";
  for (const line of analysis.lines) {
    const description = line.description.trim();
    if (!lineHasAmount(line)) {
      if (!description) continue;
      const previous = rows.at(-1);
      if (previous) previous.description = `${previous.description} ${description}`.trim();
      else pendingDescription = `${pendingDescription} ${description}`.trim();
      continue;
    }
    if (SUMMARY_ROW.test(description)) continue;
    rows.push({ line, description: `${pendingDescription} ${description}`.trim() });
    pendingDescription = "";
  }

  let lines: DraftLine[] = rows.map(({ line, description }) => {
    const taxRate = numberOrFallback(line.tax_rate, defaults.taxRate);
    const base = netLineBase(line, taxRate);
    const exact = exactQuantityAndPrice(line, base, description || analysis.description || "Gasto analizado por IA");
    return {
      ...exact,
      taxRate,
      taxDeductiblePct: numberOrFallback(line.tax_deductible_pct, defaults.deductiblePct),
      retentionRate: numberOrFallback(line.retention_rate, 0),
      suggestedExpenseAccountCode: line.suggested_expense_account_code ?? analysis.suggested_expense_account_code ?? undefined,
    };
  });

  // Descuentos/abonos como línea negativa: se restan de la mayor línea con el mismo IVA y retención.
  const negatives = lines.filter((line) => line.unitPrice * line.quantity < 0);
  for (const negative of negatives) {
    const amount = round2(negative.unitPrice * negative.quantity);
    const target = lines
      .filter((line) => line !== negative && line.taxRate === negative.taxRate && line.retentionRate === negative.retentionRate && line.unitPrice * line.quantity + amount >= 0)
      .sort((a, b) => b.unitPrice * b.quantity - a.unitPrice * a.quantity)[0];
    if (!target) {
      warnings.push(`«${negative.description}» es un descuento o abono que no se pudo restar de otra línea: ajústalo a mano.`);
      continue;
    }
    const base = round2(target.unitPrice * target.quantity + amount);
    const detail = target.quantity === 1 ? "" : `${formatNumber(target.quantity)} × ${formatNumber(target.unitPrice)}, `;
    Object.assign(target, { quantity: 1, unitPrice: base, description: `${target.description} (${detail}${negative.description.toLocaleLowerCase("es-ES")} ${formatNumber(amount)})` });
    lines = lines.filter((line) => line !== negative);
  }

  // Cargos (portes, manipulación, canon…) o descuento global que solo aparecen al pie de la factura.
  // Se comparan con la base imponible del cuadro de IVA, que es la que lleva al total (el subtotal
  // leído puede ser el importe bruto de las líneas, antes de esos cargos).
  const baseSum = () => centsToNumber(lines.reduce((sum, line) => sum + amountToCents(line.unitPrice * line.quantity), 0));
  const vatBases = analysis.taxes.filter((tax) => VAT_TAX_TYPES.has(tax.tax_type) && isAmount(tax.base_amount));
  const target = vatBases.length > 0 ? centsToNumber(vatBases.reduce((sum, tax) => sum + amountToCents(Number(tax.base_amount)), 0)) : analysis.subtotal_amount;
  if (lines.length > 0 && isAmount(target) && amountToCents(baseSum()) !== amountToCents(target)) {
    const charges = footerCharges(analysis);
    const chargesCents = charges.reduce((sum, charge) => sum + amountToCents(charge.amount), 0);
    const discount = analysis.discount_amount ?? 0;
    if (charges.length > 0 && amountToCents(baseSum()) + chargesCents === amountToCents(target)) {
      for (const charge of charges) {
        lines.push({ ...lines[0], description: charge.description, quantity: 1, unitPrice: round2(charge.amount), taxRate: charge.taxRate ?? lines[0].taxRate });
      }
    } else if (discount > 0 && amountToCents(baseSum() - discount) === amountToCents(target)) {
      const gross = baseSum();
      let remainingCents = amountToCents(discount);
      const largest = lines.reduce((best, line) => (line.unitPrice * line.quantity > best.unitPrice * best.quantity ? line : best), lines[0]);
      for (const line of lines) {
        if (line === largest) continue;
        const shareCents = roundHalfAwayFromZero((amountToCents(line.unitPrice * line.quantity) * amountToCents(discount)) / amountToCents(gross));
        remainingCents -= shareCents;
        Object.assign(line, { quantity: 1, unitPrice: round2(line.unitPrice * line.quantity - centsToNumber(shareCents)) });
      }
      Object.assign(largest, { quantity: 1, unitPrice: round2(largest.unitPrice * largest.quantity - centsToNumber(remainingCents)) });
      warnings.push(`El descuento de ${formatNumber(discount)} del pie de la factura se ha repartido entre las líneas.`);
    }
  }

  // Retención indicada solo al pie: se aplica a las líneas si corresponde a un tipo habitual.
  if (lines.length > 0 && lines.every((line) => line.retentionRate === 0)) {
    const rate = documentRetentionRate(analysis, baseSum());
    if (rate > 0) lines = lines.map((line) => ({ ...line, retentionRate: rate }));
  }

  return { lines, warnings };
}

/**
 * Resumen por tipo de IVA (bases del pie de la factura) cuando cuadra con el total: alternativa
 * fiable si alguna línea no se ha leído bien (facturas largas o de varias páginas).
 */
function taxSummaryLines(analysis: ExpenseInvoiceAiAnalysis, retentionRate: number, deductiblePct: number) {
  const vatTaxes = analysis.taxes.filter((tax) => VAT_TAX_TYPES.has(tax.tax_type) && isAmount(tax.base_amount) && isAmount(tax.rate));
  if (vatTaxes.length === 0 || !isAmount(analysis.total_amount)) return undefined;
  const summary = vatTaxes.map((tax) => ({ taxRate: Number(tax.rate), base: round2(Number(tax.base_amount)), taxDeductiblePct: numberOrFallback(tax.deductible_pct, deductiblePct) }));
  const total = draftTotalCents(summary.map((entry) => ({ quantity: 1, unitPrice: entry.base, taxRate: entry.taxRate, retentionRate })));
  return Math.abs(total - amountToCents(analysis.total_amount)) <= 2 ? summary : undefined;
}

export function toExpenseInvoiceAiDraft(
  analysis: ExpenseInvoiceAiAnalysis,
  options: { ownTaxIds?: readonly (string | null | undefined)[] } = {},
): ExpenseInvoiceAiDraft {
  const fallbackUnitPrice = analysis.subtotal_amount ?? analysis.total_amount ?? 0;
  // El primer impuesto puede ser la retención: el tipo por defecto de las líneas sale del IVA (o IGIC/IPSI).
  const vatTax = analysis.taxes.find((tax) => tax.tax_type === "VAT" || tax.tax_type === "IGIC" || tax.tax_type === "IPSI");
  const ownTaxIds = new Set((options.ownTaxIds ?? []).map(normalizedTaxId).filter(Boolean));
  const readTaxId = analysis.supplier_tax_id ?? undefined;
  const taxIdIsOwn = Boolean(readTaxId && ownTaxIds.has(normalizedTaxId(readTaxId)));
  const issueDate = isoDateOrUndefined(analysis.invoice_issue_date);
  const defaults = { taxRate: numberOrFallback(vatTax?.rate ?? null, 21), deductiblePct: numberOrFallback(vatTax?.deductible_pct ?? null, 100) };
  const built = buildDraftLines(analysis, defaults);
  const lines: DraftLine[] = built.lines.length > 0
    ? built.lines
    : [{
      description: analysis.description || analysis.invoice_number || "Gasto analizado por IA",
      quantity: 1,
      unitPrice: fallbackUnitPrice,
      taxRate: defaults.taxRate,
      taxDeductiblePct: defaults.deductiblePct,
      retentionRate: documentRetentionRate(analysis, fallbackUnitPrice),
      suggestedExpenseAccountCode: analysis.suggested_expense_account_code ?? undefined,
    }];
  const linesTotalCents = draftTotalCents(lines);
  const totalsMismatch = isAmount(analysis.total_amount) && Math.abs(linesTotalCents - amountToCents(analysis.total_amount)) > 2;
  const taxSummary = lines.length > 1 || totalsMismatch ? taxSummaryLines(analysis, lines[0]?.retentionRate ?? 0, defaults.deductiblePct) : undefined;
  const extraWarnings = [
    ...(taxIdIsOwn ? ["El CIF/NIF leído es el de tu empresa (destinatario), no el del proveedor: indícalo a mano."] : []),
    ...(issueDate ? [] : ["No se pudo leer la fecha de factura: indícala antes de registrar."]),
    ...built.warnings,
    ...(totalsMismatch
      ? [`Las líneas leídas suman ${formatNumber(centsToNumber(linesTotalCents))} y el total de la factura es ${formatNumber(Number(analysis.total_amount))}: comprueba que no falte ninguna línea${taxSummary ? " o usa el resumen por tipo de IVA" : ""}.`]
      : []),
  ];

  return {
    supplierName: analysis.supplier_name ?? undefined,
    supplierTaxId: taxIdIsOwn ? undefined : readTaxId,
    supplierEmail: analysis.supplier_email ?? undefined,
    supplierPhone: analysis.supplier_phone ?? undefined,
    supplierAddress: analysis.supplier_address ?? undefined,
    supplierPostalCode: analysis.supplier_postal_code ?? undefined,
    supplierCity: analysis.supplier_city ?? undefined,
    supplierProvince: analysis.supplier_province ?? undefined,
    supplierCountryCode: analysis.supplier_country_code ?? undefined,
    supplierDocumentNumber: analysis.invoice_number ?? undefined,
    currencyCode: analysis.currency_code ?? undefined,
    issueDate,
    dueDate: isoDateOrUndefined(analysis.invoice_due_date),
    subtotalAmount: analysis.subtotal_amount ?? undefined,
    taxAmount: analysis.tax_amount ?? undefined,
    retentionAmount: analysis.retention_amount ?? undefined,
    totalAmount: analysis.total_amount ?? undefined,
    lines,
    ...(taxSummary ? { taxSummary } : {}),
    confidence: extraWarnings.length > 0 ? "low" : cappedConfidence(confidenceLabel(analysis.confidence_overall), lines, analysis),
    warnings: [...analysis.warnings, ...extraWarnings, ...analysis.blocking_errors.map((error) => `Bloqueo: ${error}`)],
  };
}

/**
 * Modelo de lectura de facturas: GPT-6 Luna por defecto (pensado para extracción de alto volumen,
 * 0,10 $ / 0,50 $ por millón de tokens, imagen y salida estructurada). Se cambia con
 * OPENAI_EXPENSE_ANALYSIS_MODEL.
 */
export const DEFAULT_EXPENSE_ANALYSIS_MODEL = "gpt-6-luna";

export function expenseAnalysisModel() {
  return process.env.OPENAI_EXPENSE_ANALYSIS_MODEL?.trim() || DEFAULT_EXPENSE_ANALYSIS_MODEL;
}

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
type ExpenseReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Razonamiento del modelo: `low` por defecto (extraer datos de una factura no necesita más; es más
 * rápido y barato). OPENAI_EXPENSE_ANALYSIS_REASONING_EFFORT lo cambia; `off` no envía el parámetro
 * (modelos sin razonamiento, que lo rechazarían).
 */
export function expenseAnalysisReasoningEffort(): ExpenseReasoningEffort | null {
  const configured = process.env.OPENAI_EXPENSE_ANALYSIS_REASONING_EFFORT?.trim().toLowerCase();
  if (configured === "off") return null;
  return REASONING_EFFORTS.find((effort) => effort === configured) ?? "low";
}

export async function analyzeExpenseInvoiceWithOpenAI(input: {
  fileName: string;
  contentType: string;
  buffer: Buffer;
  ownTaxIds?: readonly (string | null | undefined)[];
}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no está configurada.");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = expenseAnalysisModel();
  const reasoningEffort = expenseAnalysisReasoningEffort();
  const fileData = `data:${input.contentType};base64,${input.buffer.toString("base64")}`;
  const filePart = input.contentType === "application/pdf"
    ? { type: "input_file" as const, filename: input.fileName, file_data: fileData }
    : { type: "input_image" as const, image_url: fileData, detail: "high" as const };

  const response = await client.responses.parse({
    model,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    input: [
      {
        role: "system",
        content: "Eres un extractor experto de facturas recibidas españolas para un ERP. Devuelve solo datos presentes o inferencias conservadoras. Usa null cuando un campo no sea fiable. El CIF/NIF del proveedor es más importante que el nombre.",
      },
      {
        role: "user",
        content: [
          filePart,
          {
            type: "input_text",
            text: "Analiza esta factura de proveedor/gasto y extrae los campos siguiendo el esquema. Normaliza importes con punto decimal, fechas como YYYY-MM-DD y CIF/NIF sin espacios, puntos ni guiones. Líneas: recorre todas las páginas y devuelve una entrada por cada concepto facturado, en orden. Si la descripción de un concepto ocupa varias filas, únela en una sola línea; no crees líneas sin importe. No incluyas como líneas las filas de subtotal, bases, IVA, retención, total ni «suma y sigue»/«suma anterior» entre páginas. Un descuento o abono en su propia fila va como línea con importe negativo; los cargos que solo aparecen al pie (portes, gastos de manipulación, canon, gastos de gestión, recargos) van uno a uno en additional_charges con su importe (los portes también en shipping_amount) y un descuento global del pie en discount_amount. subtotal_amount es la base imponible total (la del cuadro de IVA, incluidos esos cargos y descuentos), no el importe bruto de las líneas. En cada línea, subtotal_amount debe ser la base neta después de descuentos, no la base bruta antes del descuento, y tax_rate es el IVA de esa línea (puede variar entre líneas). En taxes devuelve una entrada por tipo de IVA con su base y su cuota, tal como aparecen en el cuadro de impuestos. En warnings incluye solo problemas que obliguen a revisar la lectura (datos ilegibles, importes que no cuadran, dudas sobre el proveedor), no textos legales ni avisos genéricos del documento. suggested_expense_account_code es la cuenta de 3 dígitos del Plan General Contable español más adecuada (600 compras de mercaderías para revender, 602 otros aprovisionamientos, 621 alquileres, 622 reparaciones, 623 asesorías y profesionales, 624 transportes, 625 seguros, 626 servicios bancarios, 627 publicidad, 628 suministros como luz, agua, gas, teléfono, internet o combustible, 629 otros servicios como material de oficina, viajes o software, 631 tributos); usa null si no está claro.",
          },
        ],
      },
    ],
    text: {
      format: zodTextFormat(expenseInvoiceAiAnalysisSchema, "expense_invoice_analysis"),
    },
  });

  if (!response.output_parsed) throw new Error("OpenAI no devolvió un análisis estructurado.");
  return {
    analysis: response.output_parsed,
    draft: toExpenseInvoiceAiDraft(response.output_parsed, { ownTaxIds: input.ownTaxIds }),
    model,
  };
}
