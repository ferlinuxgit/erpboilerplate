import { afterEach, describe, expect, it, vi as vitest } from "vitest";

import { type ExpenseInvoiceAiAnalysis, expenseAnalysisModel, expenseAnalysisReasoningEffort, toExpenseInvoiceAiDraft } from "@/server/ai/expense-invoice-analysis";

function baseAnalysis(patch: Partial<ExpenseInvoiceAiAnalysis> = {}): ExpenseInvoiceAiAnalysis {
  return {
    supplier_name: "Proveedor Test SL",
    supplier_commercial_name: null,
    supplier_tax_id: "B12345674",
    supplier_vat_number: null,
    supplier_email: null,
    supplier_phone: null,
    supplier_website: null,
    supplier_address: null,
    supplier_postal_code: null,
    supplier_city: null,
    supplier_province: null,
    supplier_country_code: "ES",
    customer_name: null,
    customer_tax_id: null,
    customer_address: null,
    invoice_number: "F-1",
    invoice_series: null,
    invoice_issue_date: "2026-06-03",
    invoice_operation_date: null,
    invoice_due_date: null,
    invoice_received_date: null,
    currency_code: "EUR",
    exchange_rate: 1,
    payment_method: "unknown",
    payment_terms: null,
    supplier_iban: null,
    supplier_bic: null,
    purchase_order_number: null,
    delivery_note_number: null,
    contract_number: null,
    invoice_reference: null,
    description: "Gasto test",
    expense_category: "other",
    suggested_expense_account_code: null,
    is_purchase_order_related: false,
    is_recurring: false,
    recurrence_periodicity: null,
    subtotal_amount: 90,
    discount_amount: 10,
    shipping_amount: 0,
    tax_amount: 18.9,
    retention_amount: 0,
    surcharge_amount: 0,
    rounding_amount: 0,
    total_amount: 108.9,
    paid_amount: 0,
    outstanding_amount: 108.9,
    taxes: [{ tax_type: "VAT", tax_name: "IVA 21%", rate: 21, base_amount: 90, tax_amount: 18.9, deductible_pct: 100 }],
    lines: [],
    validation_totals_match: true,
    validation_taxes_match: true,
    validation_supplier_tax_id_valid: true,
    possible_duplicate: false,
    duplicate_reason: null,
    warnings: [],
    blocking_errors: [],
    confidence_overall: 0.95,
    confidence_supplier: 0.95,
    confidence_supplier_tax_id: 0.95,
    confidence_invoice_number: 0.95,
    confidence_dates: 0.95,
    confidence_amounts: 0.95,
    confidence_lines: 0.95,
    confidence_taxes: 0.95,
    ...patch,
  };
}

describe("expense invoice AI analysis mapping", () => {
  it("uses discounted net base as ERP unit price", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({
      lines: [{
        line_number: 1,
        description: "Servicio con descuento",
        item_code: null,
        quantity: 1,
        unit_of_measure: null,
        unit_price: 100,
        discount_pct: 10,
        discount_amount: null,
        subtotal_amount: null,
        tax_rate: 21,
        tax_amount: 18.9,
        tax_deductible_pct: 100,
        retention_rate: 0,
        retention_amount: 0,
        total_amount: 108.9,
        suggested_expense_account_code: null,
        cost_center: null,
        project: null,
        department: null,
      }],
    }));

    expect(draft.lines[0]).toMatchObject({
      quantity: 1,
      unitPrice: 90,
      taxRate: 21,
    });
  });

  it("caps confidence to medium when no expense account was suggested", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({ lines: [], taxes: [{ tax_type: "VAT", tax_name: null, rate: 21, base_amount: 100, tax_amount: 21, deductible_pct: 100 }], suggested_expense_account_code: null }));
    expect(draft.confidence).toBe("medium");
  });

  it("keeps high confidence when the account and VAT rate were read", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({ lines: [], taxes: [{ tax_type: "VAT", tax_name: null, rate: 21, base_amount: 100, tax_amount: 21, deductible_pct: 100 }], suggested_expense_account_code: "628" }));
    expect(draft.confidence).toBe("high");
    expect(draft.lines[0].suggestedExpenseAccountCode).toBe("628");
  });

  it("discards the company's own tax id and impossible dates, and warns about both", () => {
    const draft = toExpenseInvoiceAiDraft(
      baseAnalysis({ supplier_tax_id: "B87654315", invoice_issue_date: "2026-02-31", suggested_expense_account_code: "628" }),
      { ownTaxIds: ["ES-B87654315"] },
    );
    expect(draft.supplierTaxId).toBeUndefined();
    expect(draft.issueDate).toBeUndefined();
    expect(draft.confidence).toBe("low");
    expect(draft.warnings.join(" ")).toMatch(/tu empresa/);
    expect(draft.warnings.join(" ")).toMatch(/fecha de factura/);
  });

  it("takes the default VAT rate from the VAT entry, not from a withholding listed first", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({
      lines: [],
      taxes: [
        { tax_type: "withholding", tax_name: "IRPF", rate: 15, base_amount: 100, tax_amount: 15, deductible_pct: null },
        { tax_type: "VAT", tax_name: "IVA", rate: 21, base_amount: 100, tax_amount: 21, deductible_pct: 100 },
      ],
    }));
    expect(draft.lines[0].taxRate).toBe(21);
  });
});

type AnalysisLine = ExpenseInvoiceAiAnalysis["lines"][number];

function line(patch: Partial<AnalysisLine>): AnalysisLine {
  return {
    line_number: 1,
    description: "Concepto",
    item_code: null,
    quantity: null,
    unit_of_measure: null,
    unit_price: null,
    discount_pct: null,
    discount_amount: null,
    subtotal_amount: null,
    tax_rate: 21,
    tax_amount: null,
    tax_deductible_pct: null,
    retention_rate: null,
    retention_amount: null,
    total_amount: null,
    suggested_expense_account_code: "600",
    cost_center: null,
    project: null,
    department: null,
    ...patch,
  };
}

const vat21 = (base: number) => ({ tax_type: "VAT" as const, tax_name: "IVA 21%", rate: 21, base_amount: base, tax_amount: Math.round(base * 21) / 100, deductible_pct: 100 });

describe("invoices with several lines", () => {
  it("joins descriptions split over several rows and never gives a priceless line the invoice subtotal", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({
      subtotal_amount: 150, discount_amount: 0, tax_amount: 31.5, total_amount: 181.5, taxes: [vat21(150)],
      lines: [
        line({ description: "Tornillos inox M6", quantity: 10, unit_price: 5, subtotal_amount: 50 }),
        line({ description: "cabeza hexagonal (caja 100 uds)", tax_rate: null, suggested_expense_account_code: null }),
        line({ description: "Arandelas", quantity: 1, unit_price: 100, subtotal_amount: 100 }),
      ],
    }));
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[0]).toMatchObject({ description: "Tornillos inox M6 cabeza hexagonal (caja 100 uds)", quantity: 10, unitPrice: 5 });
    expect(draft.lines[1]).toMatchObject({ description: "Arandelas", unitPrice: 100 });
    expect(draft.warnings.join(" ")).not.toMatch(/suman/);
  });

  it("drops subtotal, VAT and carry-forward rows read as lines", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({
      subtotal_amount: 80, discount_amount: 0, tax_amount: 16.8, total_amount: 96.8, taxes: [vat21(80)],
      lines: [
        line({ description: "Papel A4", quantity: 2, unit_price: 20, subtotal_amount: 40 }),
        line({ description: "Suma y sigue", subtotal_amount: 40 }),
        line({ description: "Tóner", quantity: 1, unit_price: 40, subtotal_amount: 40 }),
        line({ description: "Base imponible", subtotal_amount: 80 }),
        line({ description: "IVA 21%", subtotal_amount: 16.8 }),
        line({ description: "TOTAL", total_amount: 96.8 }),
      ],
    }));
    expect(draft.lines.map((entry) => entry.description)).toEqual(["Papel A4", "Tóner"]);
  });

  it("keeps the exact base when quantity × 2-decimal price cannot reproduce it", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({
      subtotal_amount: 3.52, discount_amount: 0, total_amount: 4.26, taxes: [vat21(3.52)],
      lines: [line({ description: "Cable", quantity: 1.5, unit_price: 2.345, subtotal_amount: 3.52 })],
    }));
    expect(draft.lines[0]).toMatchObject({ quantity: 1, unitPrice: 3.52, description: "Cable (1,5 × 2,345)" });
  });

  it("subtracts a negative discount row from the line with the same VAT", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({
      subtotal_amount: 190, discount_amount: 0, total_amount: 229.9, taxes: [vat21(190)],
      lines: [
        line({ description: "Portátil", quantity: 1, unit_price: 150, subtotal_amount: 150 }),
        line({ description: "Ratón", quantity: 2, unit_price: 25, subtotal_amount: 50 }),
        line({ description: "Descuento promoción", quantity: 1, unit_price: -10, subtotal_amount: -10 }),
      ],
    }));
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[0]).toMatchObject({ quantity: 1, unitPrice: 140 });
    expect(draft.lines[0].description).toMatch(/descuento promoción -10/);
    expect(draft.lines.every((entry) => entry.unitPrice >= 0)).toBe(true);
  });

  it("adds shipping and spreads a footer discount when that is what makes the base match", () => {
    const withShipping = toExpenseInvoiceAiDraft(baseAnalysis({
      subtotal_amount: 108, discount_amount: 0, shipping_amount: 8, total_amount: 130.68, taxes: [vat21(108)],
      lines: [line({ description: "Pintura", quantity: 2, unit_price: 50, subtotal_amount: 100 })],
    }));
    expect(withShipping.lines.at(-1)).toMatchObject({ description: "Portes", unitPrice: 8 });

    const withDiscount = toExpenseInvoiceAiDraft(baseAnalysis({
      subtotal_amount: 270, discount_amount: 30, total_amount: 326.7, taxes: [vat21(270)],
      lines: [
        line({ description: "Silla", quantity: 1, unit_price: 200, subtotal_amount: 200 }),
        line({ description: "Lámpara", quantity: 1, unit_price: 100, subtotal_amount: 100 }),
      ],
    }));
    expect(withDiscount.lines.reduce((sum, entry) => sum + entry.unitPrice * entry.quantity, 0)).toBeCloseTo(270, 2);
    expect(withDiscount.warnings.join(" ")).not.toMatch(/suman/);
  });

  it("applies a retention printed only at the foot of the invoice", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({
      subtotal_amount: 1000, discount_amount: 0, retention_amount: 150, tax_amount: 210, total_amount: 1060, taxes: [vat21(1000)],
      lines: [
        line({ description: "Asesoría fiscal", quantity: 1, unit_price: 600, subtotal_amount: 600 }),
        line({ description: "Asesoría laboral", quantity: 1, unit_price: 400, subtotal_amount: 400 }),
      ],
    }));
    expect(draft.lines.every((entry) => entry.retentionRate === 15)).toBe(true);
    expect(draft.warnings.join(" ")).not.toMatch(/suman/);
  });

  it("warns when lines are missing and offers the per-VAT summary that matches the total", () => {
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({
      subtotal_amount: 300, discount_amount: 0, tax_amount: 52, total_amount: 352,
      taxes: [vat21(200), { tax_type: "VAT", tax_name: "IVA 10%", rate: 10, base_amount: 100, tax_amount: 10, deductible_pct: 100 }],
      lines: [line({ description: "Página 1", quantity: 1, unit_price: 200, subtotal_amount: 200 })],
    }));
    expect(draft.warnings.join(" ")).toMatch(/Las líneas leídas suman 242 y el total de la factura es 352/);
    expect(draft.confidence).toBe("low");
    expect(draft.taxSummary).toEqual([
      { taxRate: 21, base: 200, taxDeductiblePct: 100 },
      { taxRate: 10, base: 100, taxDeductiblePct: 100 },
    ]);
  });

  it("matches the total with per-rate VAT on many lines (no per-line rounding drift)", () => {
    const lines = Array.from({ length: 30 }, (_, index) => line({ line_number: index + 1, description: `Artículo ${index + 1}`, quantity: 1, unit_price: 0.33, subtotal_amount: 0.33 }));
    const draft = toExpenseInvoiceAiDraft(baseAnalysis({ subtotal_amount: 9.9, discount_amount: 0, tax_amount: 2.08, total_amount: 11.98, taxes: [vat21(9.9)], lines }));
    expect(draft.lines).toHaveLength(30);
    expect(draft.warnings.join(" ")).not.toMatch(/suman/);
  });
});

describe("expense analysis model settings", () => {
  afterEach(() => vitest.unstubAllEnvs());

  it("defaults to GPT-6 Luna with low reasoning", () => {
    vitest.stubEnv("OPENAI_EXPENSE_ANALYSIS_MODEL", "");
    vitest.stubEnv("OPENAI_EXPENSE_ANALYSIS_REASONING_EFFORT", "");
    expect(expenseAnalysisModel()).toBe("gpt-6-luna");
    expect(expenseAnalysisReasoningEffort()).toBe("low");
  });

  it("honours the configured model and effort, and 'off' omits reasoning", () => {
    vitest.stubEnv("OPENAI_EXPENSE_ANALYSIS_MODEL", "gpt-5.4-mini");
    vitest.stubEnv("OPENAI_EXPENSE_ANALYSIS_REASONING_EFFORT", "medium");
    expect(expenseAnalysisModel()).toBe("gpt-5.4-mini");
    expect(expenseAnalysisReasoningEffort()).toBe("medium");
    vitest.stubEnv("OPENAI_EXPENSE_ANALYSIS_REASONING_EFFORT", "off");
    expect(expenseAnalysisReasoningEffort()).toBeNull();
    vitest.stubEnv("OPENAI_EXPENSE_ANALYSIS_REASONING_EFFORT", "turbo");
    expect(expenseAnalysisReasoningEffort()).toBe("low");
  });
});
