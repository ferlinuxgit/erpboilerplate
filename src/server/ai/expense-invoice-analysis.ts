import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

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
  supplierDocumentNumber?: string;
  issueDate?: string;
  dueDate?: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    taxDeductiblePct: number;
    retentionRate: number;
  }>;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

function isoDateOrUndefined(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

function confidenceLabel(score: number): "high" | "medium" | "low" {
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function numberOrFallback(value: number | null, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function toExpenseInvoiceAiDraft(analysis: ExpenseInvoiceAiAnalysis): ExpenseInvoiceAiDraft {
  const fallbackUnitPrice = analysis.subtotal_amount ?? analysis.total_amount ?? 0;
  const lines = analysis.lines.length > 0
    ? analysis.lines.map((line) => ({
      description: line.description || analysis.description || "Gasto analizado por IA",
      quantity: numberOrFallback(line.quantity, 1),
      unitPrice: numberOrFallback(line.unit_price ?? line.subtotal_amount, fallbackUnitPrice),
      taxRate: numberOrFallback(line.tax_rate, analysis.taxes[0]?.rate ?? 21),
      taxDeductiblePct: numberOrFallback(line.tax_deductible_pct, analysis.taxes[0]?.deductible_pct ?? 100),
      retentionRate: numberOrFallback(line.retention_rate, 0),
    }))
    : [{
      description: analysis.description || analysis.invoice_number || "Gasto analizado por IA",
      quantity: 1,
      unitPrice: fallbackUnitPrice,
      taxRate: numberOrFallback(analysis.taxes[0]?.rate ?? null, 21),
      taxDeductiblePct: numberOrFallback(analysis.taxes[0]?.deductible_pct ?? null, 100),
      retentionRate: 0,
    }];

  return {
    supplierName: analysis.supplier_name ?? undefined,
    supplierTaxId: analysis.supplier_tax_id ?? undefined,
    supplierDocumentNumber: analysis.invoice_number ?? undefined,
    issueDate: isoDateOrUndefined(analysis.invoice_issue_date),
    dueDate: isoDateOrUndefined(analysis.invoice_due_date),
    lines,
    confidence: confidenceLabel(analysis.confidence_overall),
    warnings: [...analysis.warnings, ...analysis.blocking_errors],
  };
}

export async function analyzeExpenseInvoiceWithOpenAI(input: {
  fileName: string;
  contentType: string;
  buffer: Buffer;
}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no está configurada.");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_EXPENSE_ANALYSIS_MODEL || "gpt-5";
  const fileData = `data:${input.contentType};base64,${input.buffer.toString("base64")}`;
  const filePart = input.contentType === "application/pdf"
    ? { type: "input_file" as const, filename: input.fileName, file_data: fileData }
    : { type: "input_image" as const, image_url: fileData, detail: "high" as const };

  const response = await client.responses.parse({
    model,
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
            text: "Analiza esta factura de proveedor/gasto y extrae los campos siguiendo el esquema. Normaliza importes con punto decimal, fechas como YYYY-MM-DD y CIF/NIF sin espacios, puntos ni guiones.",
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
    draft: toExpenseInvoiceAiDraft(response.output_parsed),
    model,
  };
}
