import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { getSpanishFiscalDueDate, normalizeSpanishFiscalPeriod, spanishFiscalModelsFor } from "@/lib/fiscal-spain";
import { nextFilingPeriod } from "@/server/fiscal/obligations";
import {
  computeIncomeTaxExpenseCents,
  computeModelo130,
  computeModelo349,
  computeSupplierVat,
  isServiceExpenseAccount,
  modelo349Key,
  normalizeVatOperatorId,
  type SupplierLineInput,
} from "@/server/fiscal/spain-calc";

const issueDate = new Date(Date.UTC(2026, 3, 10));

function received(overrides: Partial<SupplierLineInput>): SupplierLineInput {
  return { invoiceId: "sup-1", number: "P-1", issueDate, totalAmount: 121, treatment: "DOMESTIC", subtotal: 100, taxAmount: 21, taxRate: 21, taxDeductiblePct: 100, ...overrides };
}

describe("Modelo 349", () => {
  it("derives keys E/S for sales and A/I for purchases", () => {
    expect(modelo349Key("sale", false)).toBe("E");
    expect(modelo349Key("sale", true)).toBe("S");
    expect(modelo349Key("purchase", false)).toBe("A");
    expect(modelo349Key("purchase", true)).toBe("I");
    expect(isServiceExpenseAccount("6230001")).toBe(true);
    expect(isServiceExpenseAccount("6000001")).toBe(false);
  });

  it("normalizes NIF-IVA with the country prefix (Greece as EL)", () => {
    expect(normalizeVatOperatorId("123456789", "DE")).toBe("DE123456789");
    expect(normalizeVatOperatorId("de 123 456 789", "DE")).toBe("DE123456789");
    expect(normalizeVatOperatorId("094259216", "GR")).toBe("EL094259216");
    expect(normalizeVatOperatorId("FR12345678901", "FR")).toBe("FR12345678901");
  });

  it("groups by operator and key, nets same-period credit notes and separates rectifications of other periods", () => {
    const result = computeModelo349([
      { key: "E", operatorName: "Kunde GmbH", operatorTaxId: "DE123456789", countryCode: "DE", baseCents: 100_000 },
      { key: "E", operatorName: "Kunde GmbH", operatorTaxId: "123456789", countryCode: "DE", baseCents: 50_000 },
      { key: "E", operatorName: "Kunde GmbH", operatorTaxId: "DE123456789", countryCode: "DE", baseCents: -20_000 },
      { key: "S", operatorName: "Kunde GmbH", operatorTaxId: "DE123456789", countryCode: "DE", baseCents: 30_000 },
      { key: "A", operatorName: "Fournisseur SARL", operatorTaxId: "FR12345678901", countryCode: "FR", baseCents: 70_000 },
      { key: "E", operatorName: "Kunde GmbH", operatorTaxId: "DE123456789", countryCode: "DE", baseCents: -5_000, rectifiesPeriod: "2026-Q1" },
    ]);
    expect(result.operators).toEqual([
      { key: "A", taxId: "FR12345678901", name: "Fournisseur SARL", countryCode: "FR", amount: 700 },
      { key: "E", taxId: "DE123456789", name: "Kunde GmbH", countryCode: "DE", amount: 1300 },
      { key: "S", taxId: "DE123456789", name: "Kunde GmbH", countryCode: "DE", amount: 300 },
    ]);
    expect(result.rectifications).toEqual([
      { key: "E", taxId: "DE123456789", name: "Kunde GmbH", countryCode: "DE", amount: -50, originalPeriod: "2026-Q1" },
    ]);
    expect(result.operatorCount).toBe(3);
    expect(result.totalAmount).toBe(2300);
    expect(result.issues).toEqual([]);
  });

  it("flags operators without a valid EU VAT id", () => {
    const result = computeModelo349([{ key: "E", operatorName: "Sin NIF", operatorTaxId: null, countryCode: "IT", baseCents: 1_000 }]);
    expect(result.operators[0].taxId).toBe("Sin NIF-IVA");
    expect(result.issues[0].code).toBe("model-349-vat-id");
  });
});

describe("Modelo 130", () => {
  const quarter = (income: number, expenses: number, withholding = 0) => ({ incomeCents: income * 100, expenseCents: expenses * 100, withholdingCents: withholding * 100 });
  const box = (result: ReturnType<typeof computeModelo130>, code: string) => result.boxes.find((entry) => entry.box === code)?.amount;

  it("computes 20 % of cumulative net income minus withholdings (first quarter)", () => {
    const result = computeModelo130([quarter(10_000, 4_000, 300)], 1);
    expect([box(result, "01"), box(result, "02"), box(result, "03"), box(result, "04"), box(result, "05"), box(result, "06"), box(result, "07"), box(result, "19")])
      .toEqual([10_000, 4_000, 6_000, 1_200, 0, 300, 900, 900]);
    expect(result.resultCents).toBe(90_000);
  });

  it("is cumulative and deducts previous positive payments (casilla 05)", () => {
    const result = computeModelo130([quarter(10_000, 4_000, 300), quarter(8_000, 2_000, 200)], 2);
    // Acumulado: 18.000 − 6.000 = 12.000 → 2.400; − 900 pagado en T1 − 500 retenciones acumuladas = 1.000.
    expect([box(result, "01"), box(result, "03"), box(result, "04"), box(result, "05"), box(result, "06"), box(result, "19")]).toEqual([18_000, 12_000, 2_400, 900, 500, 1_000]);
  });

  it("never computes a negative 04 and carries negative results to later quarters (casilla 15)", () => {
    const loss = computeModelo130([quarter(1_000, 3_000, 150)], 1);
    expect(box(loss, "04")).toBe(0);
    expect(box(loss, "19")).toBe(-150);

    const recovered = computeModelo130([quarter(1_000, 3_000, 150), quarter(10_000, 2_000, 0)], 2);
    // Acumulado 11.000 − 5.000 = 6.000 → 1.200; 05 = 0; 06 = 150 → 07 = 1.050; 15 = 150 → 19 = 900.
    expect([box(recovered, "04"), box(recovered, "05"), box(recovered, "06"), box(recovered, "07"), box(recovered, "15"), box(recovered, "19")]).toEqual([1_200, 0, 150, 1_050, 150, 900]);
  });

  it("reports the share of income subject to withholding (70 % rule)", () => {
    const result = computeModelo130([{ incomeCents: 1_000_000, expenseCents: 0, withholdingCents: 150_000, withheldIncomeCents: 800_000 }], 1);
    expect(result.withheldIncomePct).toBe(80);
  });

  it("uses supplier invoice bases plus non-deductible VAT as expenses, excluding investment goods", () => {
    const cents = computeIncomeTaxExpenseCents([
      received({ subtotal: 100, taxAmount: 21 }),
      received({ subtotal: 200, taxAmount: 42, taxDeductiblePct: 50, expenseAccountCode: "625" }),
      received({ subtotal: 1_000, taxAmount: 210, expenseAccountCode: "217" }),
    ], 100);
    expect(cents).toBe(10_000 + 20_000 + 2_100);
  });
});

describe("303 self-assessed total check (new semantics: total = base − withholding)", () => {
  it("does not warn for INTRA_EU / REVERSE_CHARGE invoices whose total is base − withholding", () => {
    const result = computeSupplierVat([
      received({ invoiceId: "a", treatment: "INTRA_EU", subtotal: 1_000, taxAmount: 210, totalAmount: 1_000 }),
      received({ invoiceId: "b", treatment: "REVERSE_CHARGE", subtotal: 500, taxAmount: 105, retentionAmount: 75, retentionRate: 15, totalAmount: 425 }),
      received({ invoiceId: "c", treatment: "INTRA_EU", subtotal: 100, taxAmount: 21, totalAmount: 50 }),
      received({ invoiceId: "c", treatment: "INTRA_EU", subtotal: -50, taxAmount: -10.5, totalAmount: 50 }),
    ], 100);
    expect(result.invoicesWithChargedSelfAssessedVat).toBe(0);
  });

  it("warns for legacy invoices whose total still includes the self-assessed VAT", () => {
    const result = computeSupplierVat([
      received({ invoiceId: "legacy", treatment: "INTRA_EU", subtotal: 1_000, taxAmount: 210, totalAmount: 1_210 }),
      received({ invoiceId: "domestic", treatment: "DOMESTIC", subtotal: 1_000, taxAmount: 210, totalAmount: 1_210 }),
    ], 100);
    expect(result.invoicesWithChargedSelfAssessedVat).toBe(1);
  });
});

describe("periods and due dates of the new models", () => {
  it("accepts only quarters for 130 and months or quarters for 349", () => {
    expect(normalizeSpanishFiscalPeriod("2026-Q3", "130")).toBe("2026-Q3");
    expect(normalizeSpanishFiscalPeriod("2026-07", "130")).toBeNull();
    expect(normalizeSpanishFiscalPeriod("2026-07", "349")).toBe("2026-07");
  });

  it("uses 20th of next month and 30 January for the last period", () => {
    expect(getSpanishFiscalDueDate("2026-Q3", "130")?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026-Q4", "130")?.toISOString()).toBe("2027-01-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026-Q4", "349")?.toISOString()).toBe("2027-01-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026-12", "349")?.toISOString()).toBe("2027-01-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026-Q4", "115")?.toISOString()).toBe("2027-01-20T00:00:00.000Z");
  });

  it("shows the 130 only to individuals", () => {
    expect(spanishFiscalModelsFor("company").some((model) => model.code === "130")).toBe(false);
    expect(spanishFiscalModelsFor("individual").some((model) => model.code === "130")).toBe(true);
  });

  it("picks the next filing period whose deadline has not passed", () => {
    expect(nextFilingPeriod("303", "quarterly", new Date(Date.UTC(2026, 8, 24)))).toBe("2026-Q3");
    expect(nextFilingPeriod("303", "quarterly", new Date(Date.UTC(2026, 9, 5)))).toBe("2026-Q3");
    expect(nextFilingPeriod("303", "quarterly", new Date(Date.UTC(2026, 9, 25)))).toBe("2026-Q4");
    expect(nextFilingPeriod("303", "quarterly", new Date(Date.UTC(2027, 0, 15)))).toBe("2026-Q4");
    expect(nextFilingPeriod("111", "monthly", new Date(Date.UTC(2026, 8, 10)))).toBe("2026-08");
    expect(nextFilingPeriod("130", "monthly", new Date(Date.UTC(2026, 8, 10)))).toBe("2026-Q3");
  });
});
