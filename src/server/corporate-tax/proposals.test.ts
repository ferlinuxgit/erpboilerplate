import { describe, expect, it } from "vitest";

import { buildCorporateTaxEntryLines, computeLossCredit, entryTotals, lossCreditExpenseCents } from "@/server/corporate-tax/posting-model";
import { isCapitalizationEquityAccount, proposeCapitalizationReserve, proposeFinancialExpensesLimit } from "@/server/corporate-tax/proposals";

const eur = (value: number) => Math.round(value * 100);

describe("limitación de gastos financieros (art. 16)", () => {
  const base = { financialIncomeCents: 0, depreciationCents: 0, capitalSubsidiesCents: 0, assetDisposalResultCents: 0, periodDays: 365 };

  it("por debajo del millón todo es deducible", () => {
    const result = proposeFinancialExpensesLimit({ ...base, financialExpensesCents: eur(200_000), operatingResultCents: eur(100_000) });
    expect(result.limitCents).toBe(eur(1_000_000));
    expect(result.excessCents).toBe(0);
  });

  it("30 % del beneficio operativo, que suma la amortización y quita los resultados del inmovilizado", () => {
    const result = proposeFinancialExpensesLimit({
      ...base,
      financialExpensesCents: eur(3_000_000),
      financialIncomeCents: eur(200_000),
      operatingResultCents: eur(5_000_000),
      depreciationCents: eur(2_000_000),
      capitalSubsidiesCents: eur(100_000),
      assetDisposalResultCents: eur(900_000),
    });
    // Beneficio operativo: 5 + 2 − 0,1 − 0,9 = 6 millones → límite 1,8 millones.
    expect(result.operatingProfitCents).toBe(eur(6_000_000));
    expect(result.limitCents).toBe(eur(1_800_000));
    expect(result.netFinancialExpensesCents).toBe(eur(2_800_000));
    expect(result.excessCents).toBe(eur(1_000_000));
    expect(result.explanation).toContain("no es deducible");
  });

  it("prorratea el millón en periodos cortos (art. 16.4)", () => {
    const result = proposeFinancialExpensesLimit({ ...base, financialExpensesCents: eur(800_000), operatingResultCents: 0, periodDays: 73 });
    expect(result.minimumCents).toBe(eur(200_000));
    expect(result.excessCents).toBe(eur(600_000));
  });
});

describe("reserva de capitalización (art. 25)", () => {
  it("20 % del incremento de los fondos propios computables desde 2025", () => {
    const result = proposeCapitalizationReserve({ openingEquityCents: eur(100_000), closingEquityCents: eur(150_000), startYear: 2025 });
    expect(result?.increaseCents).toBe(eur(50_000));
    expect(result?.pct).toBe(20);
    expect(result?.reductionCents).toBe(eur(10_000));
  });

  it("sin incremento no hay reducción; antes de 2025 no se propone", () => {
    expect(proposeCapitalizationReserve({ openingEquityCents: eur(100), closingEquityCents: eur(50), startYear: 2026 })?.reductionCents).toBe(0);
    expect(proposeCapitalizationReserve({ openingEquityCents: 0, closingEquityCents: eur(50), startYear: 2024 })).toBeNull();
  });

  it("no cuenta la reserva legal ni la estatutaria", () => {
    expect(isCapitalizationEquityAccount("1130000")).toBe(true);
    expect(isCapitalizationEquityAccount("1200000")).toBe(true);
    expect(isCapitalizationEquityAccount("1120000")).toBe(false);
    expect(isCapitalizationEquityAccount("1141000")).toBe(false);
    expect(isCapitalizationEquityAccount("1290000")).toBe(false);
    expect(isCapitalizationEquityAccount("1000000")).toBe(false);
  });
});

describe("crédito por bases negativas (4745)", () => {
  it("reconoce la base negativa del año y aplica lo compensado hasta el saldo", () => {
    expect(computeLossCredit({ generatedLossCents: eur(40_000), compensatedCents: 0, ratePct: 25, ledgerBalanceCents: 0 })).toEqual({ recognizeCents: eur(10_000), reverseCents: 0 });
    expect(computeLossCredit({ generatedLossCents: 0, compensatedCents: eur(40_000), ratePct: 25, ledgerBalanceCents: eur(6_000) })).toEqual({ recognizeCents: 0, reverseCents: eur(6_000) });
  });

  it("el asiento cuadra: (4745) a (6301) y (6301) a (4745)", () => {
    const lossCredit = { recognizeCents: eur(10_000), reverseCents: 0 };
    const lines = buildCorporateTaxEntryLines({ netQuotaCents: 0, withholdingsCents: eur(100), installmentsCents: 0, lossCredit, yearCode: "2025" });
    expect(lines.find((line) => line.role === "lossCredit")?.debitCents).toBe(eur(10_000));
    expect(lines.find((line) => line.role === "deferredTax")?.creditCents).toBe(eur(10_000));
    const totals = entryTotals(lines);
    expect(totals.debitCents).toBe(totals.creditCents);
    expect(lossCreditExpenseCents(lossCredit)).toBe(-eur(10_000));

    const reversal = buildCorporateTaxEntryLines({ netQuotaCents: eur(5_000), withholdingsCents: 0, installmentsCents: 0, lossCredit: { recognizeCents: 0, reverseCents: eur(3_000) }, yearCode: "2026" });
    expect(reversal.find((line) => line.role === "lossCredit")?.creditCents).toBe(eur(3_000));
    const reversalTotals = entryTotals(reversal);
    expect(reversalTotals.debitCents).toBe(reversalTotals.creditCents);
  });

  it("sin la opción el asiento no cambia", () => {
    const lines = buildCorporateTaxEntryLines({ netQuotaCents: eur(1_000), withholdingsCents: 0, installmentsCents: 0, yearCode: "2025" });
    expect(lines.some((line) => line.role === "lossCredit")).toBe(false);
  });
});
