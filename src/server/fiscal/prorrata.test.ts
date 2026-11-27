import { describe, expect, it } from "vitest";

import {
  computeFinalProrrata,
  computeInvestmentGoodsRegularization,
  computeProrrataRegularization,
  normalizeVatProrataFinal,
  type InvestmentGoodInput,
} from "@/server/fiscal/prorrata";
import { buildModelo303Boxes, buildModelo390Summary, computeIssuedVat, computeModelo303Totals, computeSupplierVat, type IssuedLineInput, type SupplierLineInput } from "@/server/fiscal/spain-calc";

const issueDate = new Date(Date.UTC(2026, 3, 10));

function issued(overrides: Partial<IssuedLineInput>): IssuedLineInput {
  return { invoiceId: "inv-1", number: "F-1", issueDate, totalAmount: 121, treatment: "DOMESTIC", quantity: 1, unitPrice: 100, taxRate: 21, ...overrides };
}

function received(overrides: Partial<SupplierLineInput>): SupplierLineInput {
  return { invoiceId: "sup-1", number: "P-1", issueDate, totalAmount: 121, treatment: "DOMESTIC", subtotal: 100, taxAmount: 21, taxRate: 21, taxDeductiblePct: 100, ...overrides };
}

describe("prorrata definitiva (art. 104 LIVA)", () => {
  it("operaciones con derecho a deducción entre el total, redondeado a la unidad superior", () => {
    const year = computeIssuedVat([
      issued({ invoiceId: "a", unitPrice: 8201 }),
      issued({ invoiceId: "b", unitPrice: 1799, taxRate: 0, treatment: "EXEMPT" }),
    ]);
    // 8.201 / 10.000 = 82,01 % → 83 %.
    expect(computeFinalProrrata(year)).toEqual({ totalCents: 1_000_000, deductibleCents: 820_100, exemptCents: 179_900, pct: 83 });
  });

  it("un cociente exacto no sube de unidad, y sin exentas es el 100 %", () => {
    const exact = computeIssuedVat([issued({ invoiceId: "a", unitPrice: 8000 }), issued({ invoiceId: "b", unitPrice: 2000, taxRate: 0, treatment: "EXEMPT" })]);
    expect(computeFinalProrrata(exact).pct).toBe(80);
    const full = computeIssuedVat([issued({ invoiceId: "a" }), issued({ invoiceId: "b", treatment: "INTRA_EU", taxRate: 0 }), issued({ invoiceId: "c", treatment: "EXPORT", taxRate: 0 })]);
    expect(computeFinalProrrata(full).pct).toBe(100);
  });

  it("sin operaciones no hay porcentaje, y suma varios bloques del año", () => {
    expect(computeFinalProrrata(computeIssuedVat([])).pct).toBeNull();
    const taxed = computeIssuedVat([issued({ unitPrice: 500 })]);
    const exempt = computeIssuedVat([issued({ unitPrice: 500, taxRate: 0, treatment: "EXEMPT" })]);
    expect(computeFinalProrrata(taxed, exempt).pct).toBe(50);
  });
});

describe("regularización anual de la prorrata (casilla 44)", () => {
  const lines = [
    received({ invoiceId: "a", subtotal: 1000, taxAmount: 210, prorrataPct: 80 }),
    received({ invoiceId: "b", subtotal: 500, taxAmount: 105, prorrataPct: 80, taxDeductiblePct: 50 }),
  ];

  it("es la diferencia entre lo deducible con el porcentaje definitivo y lo deducido con el provisional", () => {
    // Deducido: 168 + 42 = 210. Con el 90 %: 189 + 47,25 = 236,25 → +26,25.
    expect(computeProrrataRegularization(lines, 80, 90)).toBe(2_625);
    // Con el 70 %: 147 + 36,75 = 183,75 → −26,25 (hay que devolver deducción).
    expect(computeProrrataRegularization(lines, 80, 70)).toBe(-2_625);
    expect(computeProrrataRegularization(lines, 80, 80)).toBe(0);
  });

  it("entra en la casilla 44, en el total a deducir y en el resultado del 303", () => {
    const issuedVat = computeIssuedVat([issued({ unitPrice: 2000 })]);
    const supplierVat = computeSupplierVat(lines, 80);
    const adjustments = { prorrataRegularizationCents: computeProrrataRegularization(lines, 80, 70), investmentRegularizationCents: 1_000 };
    const boxes = buildModelo303Boxes(issuedVat, supplierVat, { periodYear: 2026, adjustments });
    const box = (code: string) => boxes.find((entry) => entry.box === code)?.amount;
    expect([box("43"), box("44"), box("45"), box("46")]).toEqual([10, -26.25, 193.75, 226.25]);
    expect(computeModelo303Totals(issuedVat, supplierVat, adjustments).resultCents).toBe(22_625);
    // Sin regularizaciones no aparecen las casillas.
    const plain = buildModelo303Boxes(issuedVat, supplierVat, { periodYear: 2026 });
    expect(plain.some((entry) => entry.box === "43" || entry.box === "44")).toBe(false);
    // En el 390 van en la 63 y la 522.
    const annual = buildModelo390Summary(issuedVat, supplierVat, { adjustments });
    const annualBox = (code: string) => annual.find((entry) => entry.box === code)?.amount;
    expect([annualBox("63"), annualBox("522"), annualBox("64"), annualBox("65")]).toEqual([10, -26.25, 193.75, 226.25]);
  });
});

describe("regularización de bienes de inversión (arts. 107 a 109 LIVA)", () => {
  const good = (overrides: Partial<InvestmentGoodInput> = {}): InvestmentGoodInput => ({
    invoiceId: "g1", number: "P-9", description: "Furgoneta", purchaseYear: 2024, baseCents: 2_000_000, vatCents: 420_000,
    deductiblePct: 100, appliedProrrataPct: 60, realEstate: false, ...overrides,
  });

  it("regulariza una quinta parte si la prorrata difiere en más de diez puntos de la del año de compra", () => {
    const result = computeInvestmentGoodsRegularization([good()], { year: 2026, finalPct: 80 });
    // (4.200 × 80 % − 4.200 × 60 %) / 5 = 168.
    expect(result.totalCents).toBe(16_800);
    expect(result.goods[0]).toMatchObject({ yearNumber: 3, years: 5, differencePoints: 20, purchasePct: 60, purchasePctConfirmed: false });
    // A la baja, el importe es negativo (se devuelve deducción).
    expect(computeInvestmentGoodsRegularization([good()], { year: 2026, finalPct: 40 }).totalCents).toBe(-16_800);
  });

  it("no regulariza con diez puntos o menos, pero el bien sigue en la lista", () => {
    const result = computeInvestmentGoodsRegularization([good()], { year: 2026, finalPct: 70 });
    expect(result.totalCents).toBe(0);
    expect(result.goods).toHaveLength(1);
  });

  it("usa la prorrata definitiva confirmada del año de compra si existe", () => {
    const result = computeInvestmentGoodsRegularization([good()], { year: 2026, finalPct: 80, finalByYear: { "2024": 75 } });
    expect(result.totalCents).toBe(0);
    expect(result.goods[0]).toMatchObject({ purchasePct: 75, purchasePctConfirmed: true });
  });

  it("cinco años para el resto de bienes y diez para terrenos y edificaciones", () => {
    const old = good({ purchaseYear: 2021 });
    expect(computeInvestmentGoodsRegularization([old], { year: 2026, finalPct: 100 }).goods).toHaveLength(0);
    const building = good({ purchaseYear: 2021, realEstate: true });
    const result = computeInvestmentGoodsRegularization([building], { year: 2026, finalPct: 100 });
    expect(result.goods[0]).toMatchObject({ years: 10, yearNumber: 6 });
    expect(result.totalCents).toBe(16_800);
  });

  it("deja fuera el año de la compra y los bienes de menos de 3.005,06 €", () => {
    expect(computeInvestmentGoodsRegularization([good({ purchaseYear: 2026 })], { year: 2026, finalPct: 100 }).goods).toHaveLength(0);
    expect(computeInvestmentGoodsRegularization([good({ baseCents: 300_505 })], { year: 2026, finalPct: 100 }).goods).toHaveLength(0);
  });
});

describe("porcentajes definitivos guardados", () => {
  it("solo admite ejercicios de cuatro cifras y enteros de 0 a 100", () => {
    expect(normalizeVatProrataFinal({ "2026": "83", "2025": 100, "2024": "83.5", "2023": 120, abc: 50, "2022": null })).toEqual({ "2026": 83, "2025": 100 });
    expect(normalizeVatProrataFinal(null)).toEqual({});
  });
});
