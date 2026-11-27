import { describe, expect, it } from "vitest";

import { depreciationExcessCents } from "@/server/corporate-tax/adjustments-catalog";
import { allocateLosses, computeCorporateTax, type CorporateTaxInput, type TaxAdjustment } from "@/server/corporate-tax/liquidation";
import { buildCorporateTaxEntryLines, computeDeferredTax, entryTotals } from "@/server/corporate-tax/posting-model";
import { applyRateSchedule, corporateTaxRateSchedule, suggestedRegime } from "@/server/corporate-tax/rates";

const eur = (amount: number) => Math.round(amount * 100);

function input(overrides: Partial<CorporateTaxInput> = {}): CorporateTaxInput {
  return {
    accountingResultBeforeTaxCents: eur(100_000),
    adjustments: [],
    capitalizationReserveCents: 0,
    losses: [],
    lossCompensationCents: null,
    levelingReductionCents: 0,
    levelingAdditionCents: 0,
    regime: "general",
    startYear: 2026,
    periodDays: 365,
    credits: [],
    withholdingsCents: 0,
    installmentsCents: 0,
    ...overrides,
  };
}

const adjustment = (sign: TaxAdjustment["sign"], amount: number, nature: TaxAdjustment["nature"] = "permanent"): TaxAdjustment => ({
  id: `${sign}-${amount}-${nature}`,
  kind: "other",
  concept: "Ajuste",
  sign,
  amountCents: eur(amount),
  nature,
});

describe("tipos de gravamen (art. 29.1 y D.T. 44.ª)", () => {
  it("general 25 % y nueva creación 15 %", () => {
    expect(corporateTaxRateSchedule({ regime: "general", startYear: 2026 }).brackets).toEqual([{ upToCents: null, pct: 25 }]);
    expect(corporateTaxRateSchedule({ regime: "newCompany", startYear: 2026 }).brackets).toEqual([{ upToCents: null, pct: 15 }]);
  });

  it("microempresas: escala de 2025, 2026 y definitiva", () => {
    const pcts = (year: number) => corporateTaxRateSchedule({ regime: "micro", startYear: year }).brackets.map((bracket) => bracket.pct);
    expect(pcts(2024)).toEqual([23]);
    expect(pcts(2025)).toEqual([21, 22]);
    expect(pcts(2026)).toEqual([19, 21]);
    expect(pcts(2027)).toEqual([17, 20]);
    expect(pcts(2030)).toEqual([17, 20]);
  });

  it("entidades de reducida dimensión: bajada de un punto al año hasta el 20 %", () => {
    const pct = (year: number) => corporateTaxRateSchedule({ regime: "reduced", startYear: year }).brackets[0].pct;
    expect([2024, 2025, 2026, 2027, 2028, 2029].map(pct)).toEqual([25, 24, 23, 22, 21, 20]);
  });

  it("prorratea el tramo de 50.000 € si el periodo dura menos de un año", () => {
    const schedule = corporateTaxRateSchedule({ regime: "micro", startYear: 2026, periodDays: 73 });
    expect(schedule.brackets[0].upToCents).toBe(eur(10_000));
  });

  it("reparte la base por tramos", () => {
    const schedule = corporateTaxRateSchedule({ regime: "micro", startYear: 2026 });
    expect(applyRateSchedule(eur(80_000), schedule.brackets)).toEqual([
      { baseCents: eur(50_000), pct: 19, quotaCents: eur(9_500) },
      { baseCents: eur(30_000), pct: 21, quotaCents: eur(6_300) },
    ]);
    expect(applyRateSchedule(eur(-5_000), schedule.brackets).reduce((sum, bracket) => sum + bracket.quotaCents, 0)).toBe(0);
  });

  it("propone el régimen por la cifra de negocios del año anterior", () => {
    expect(suggestedRegime(null)).toBe("general");
    expect(suggestedRegime(eur(999_999.99))).toBe("micro");
    expect(suggestedRegime(eur(1_000_000))).toBe("reduced");
    expect(suggestedRegime(eur(10_000_000))).toBe("general");
  });
});

describe("liquidación del Impuesto sobre Sociedades", () => {
  it("caso sencillo: resultado, ajustes, tipo general y cuota a ingresar", () => {
    const result = computeCorporateTax(input({
      adjustments: [adjustment("increase", 2_000), adjustment("decrease", 500)],
      withholdingsCents: eur(1_000),
      installmentsCents: eur(5_000),
      credits: [{ id: "c1", concept: "Donativos", amountCents: eur(375) }],
    }));
    expect(result.priorBaseCents).toBe(eur(101_500));
    expect(result.taxableBaseCents).toBe(eur(101_500));
    expect(result.grossQuotaCents).toBe(eur(25_375));
    expect(result.netQuotaCents).toBe(eur(25_000));
    expect(result.differentialCents).toBe(eur(19_000));
    expect(result.outcome).toBe("toPay");
    expect(result.warnings).toEqual([]);
  });

  it("sale a devolver cuando las retenciones y los pagos a cuenta superan la cuota", () => {
    const result = computeCorporateTax(input({ accountingResultBeforeTaxCents: eur(10_000), withholdingsCents: eur(4_000) }));
    expect(result.netQuotaCents).toBe(eur(2_500));
    expect(result.differentialCents).toBe(eur(-1_500));
    expect(result.outcome).toBe("toRefund");
  });

  it("pérdidas: no hay cuota y nace una base negativa a compensar", () => {
    const result = computeCorporateTax(input({ accountingResultBeforeTaxCents: eur(-30_000), adjustments: [adjustment("increase", 5_000)], losses: [{ originYear: 2024, pendingCents: eur(10_000) }] }));
    expect(result.taxableBaseCents).toBe(eur(-25_000));
    expect(result.grossQuotaCents).toBe(0);
    expect(result.generatedLossCents).toBe(eur(25_000));
    expect(result.losses.appliedCents).toBe(0);
    expect(result.losses.remaining).toEqual([{ originYear: 2024, pendingCents: eur(10_000) }]);
  });

  it("compensa bases negativas empezando por la más antigua, hasta dejar la base a cero", () => {
    const result = computeCorporateTax(input({
      losses: [{ originYear: 2023, pendingCents: eur(30_000) }, { originYear: 2021, pendingCents: eur(50_000) }, { originYear: 2024, pendingCents: eur(40_000) }],
    }));
    // Base de 100.000: el mínimo de 1 millón permite compensar toda la base.
    expect(result.losses.limitCents).toBe(eur(100_000));
    expect(result.losses.applied).toEqual([
      { originYear: 2021, amountCents: eur(50_000) },
      { originYear: 2023, amountCents: eur(30_000) },
      { originYear: 2024, amountCents: eur(20_000) },
    ]);
    expect(result.losses.remaining).toEqual([{ originYear: 2024, pendingCents: eur(20_000) }]);
    expect(result.taxableBaseCents).toBe(0);
  });

  it("límite del 70 % de la base previa cuando supera el millón", () => {
    const result = computeCorporateTax(input({ accountingResultBeforeTaxCents: eur(2_000_000), losses: [{ originYear: 2020, pendingCents: eur(5_000_000) }] }));
    expect(result.losses.limitCents).toBe(eur(1_400_000));
    expect(result.losses.appliedCents).toBe(eur(1_400_000));
    expect(result.taxableBaseCents).toBe(eur(600_000));
    expect(result.losses.remaining).toEqual([{ originYear: 2020, pendingCents: eur(3_600_000) }]);
  });

  it("mínimo de 1 millón aunque supere el 70 %, prorrateado en periodos cortos", () => {
    const full = computeCorporateTax(input({ accountingResultBeforeTaxCents: eur(1_200_000), losses: [{ originYear: 2020, pendingCents: eur(5_000_000) }] }));
    expect(full.losses.appliedCents).toBe(eur(1_000_000));
    const short = computeCorporateTax(input({ accountingResultBeforeTaxCents: eur(1_200_000), periodDays: 73, losses: [{ originYear: 2020, pendingCents: eur(5_000_000) }] }));
    // 70 % de 1.200.000 = 840.000, mayor que 1 millón × 73/365 = 200.000.
    expect(short.losses.appliedCents).toBe(eur(840_000));
  });

  it("respeta el importe que el usuario quiere compensar y avisa si pide de más", () => {
    const partial = computeCorporateTax(input({ losses: [{ originYear: 2022, pendingCents: eur(60_000) }], lossCompensationCents: eur(10_000) }));
    expect(partial.losses.appliedCents).toBe(eur(10_000));
    expect(partial.warnings).toEqual([]);
    const excessive = computeCorporateTax(input({ losses: [{ originYear: 2022, pendingCents: eur(60_000) }], lossCompensationCents: eur(90_000) }));
    expect(excessive.losses.appliedCents).toBe(eur(60_000));
    expect(excessive.warnings.map((warning) => warning.code)).toEqual(["losses-limited"]);
  });

  it("reserva de capitalización con tope del 20 % (25 % en microempresas) antes de las bases negativas", () => {
    const general = computeCorporateTax(input({ capitalizationReserveCents: eur(30_000) }));
    expect(general.capitalizationReserve.appliedCents).toBe(eur(20_000));
    expect(general.taxableBaseCents).toBe(eur(80_000));
    expect(general.warnings.map((warning) => warning.code)).toEqual(["capitalization-limited"]);
    const micro = computeCorporateTax(input({ regime: "micro", capitalizationReserveCents: eur(30_000) }));
    expect(micro.capitalizationReserve.appliedCents).toBe(eur(25_000));
  });

  it("reserva de nivelación: minora hasta el 10 % de la base y la adición la aumenta", () => {
    const result = computeCorporateTax(input({ regime: "reduced", levelingReductionCents: eur(15_000) }));
    expect(result.leveling.reductionAppliedCents).toBe(eur(10_000));
    expect(result.rateBaseCents).toBe(eur(90_000));
    expect(result.grossQuotaCents).toBe(eur(20_700)); // 23 % en 2026
    const addition = computeCorporateTax(input({ regime: "reduced", accountingResultBeforeTaxCents: eur(-8_000), levelingAdditionCents: eur(8_000) }));
    expect(addition.rateBaseCents).toBe(0);
    expect(addition.generatedLossCents).toBe(0);
  });

  it("escala de microempresas de 2026 sobre la base", () => {
    const result = computeCorporateTax(input({ regime: "micro", accountingResultBeforeTaxCents: eur(80_000) }));
    expect(result.grossQuotaCents).toBe(eur(15_800));
    expect(result.marginalRatePct).toBe(21);
  });

  it("la cuota líquida no puede ser negativa", () => {
    const result = computeCorporateTax(input({ accountingResultBeforeTaxCents: eur(1_000), credits: [{ id: "c", concept: "I+D", amountCents: eur(900) }] }));
    expect(result.grossQuotaCents).toBe(eur(250));
    expect(result.creditsAppliedCents).toBe(eur(250));
    expect(result.netQuotaCents).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["credits-limited"]);
  });

  it("reparto de bases negativas", () => {
    expect(allocateLosses([{ originYear: 2022, pendingCents: 100 }, { originYear: 2020, pendingCents: 50 }], 70)).toEqual({
      applied: [{ originYear: 2020, amountCents: 50 }, { originYear: 2022, amountCents: 20 }],
      remaining: [{ originYear: 2022, pendingCents: 80 }],
    });
  });
});

describe("asiento del impuesto", () => {
  const roles = (lines: ReturnType<typeof buildCorporateTaxEntryLines>) => lines.map((line) => [line.role, line.debitCents, line.creditCents]);

  it("a ingresar: 6300 a 473 y 4752", () => {
    const lines = buildCorporateTaxEntryLines({ netQuotaCents: eur(25_000), withholdingsCents: eur(1_000), installmentsCents: eur(5_000), yearCode: "2026" });
    expect(roles(lines)).toEqual([
      ["currentTax", eur(25_000), 0],
      ["withholdings", 0, eur(6_000)],
      ["payable", 0, eur(19_000)],
    ]);
    expect(entryTotals(lines).debitCents).toBe(entryTotals(lines).creditCents);
  });

  it("a devolver: 6300 y 4709 a 473", () => {
    const lines = buildCorporateTaxEntryLines({ netQuotaCents: eur(2_500), withholdingsCents: eur(4_000), installmentsCents: 0, yearCode: "2026" });
    expect(roles(lines)).toEqual([
      ["currentTax", eur(2_500), 0],
      ["refund", eur(1_500), 0],
      ["withholdings", 0, eur(4_000)],
    ]);
  });

  it("sin cuota pero con retenciones: 4709 a 473; sin nada, sin asiento", () => {
    expect(roles(buildCorporateTaxEntryLines({ netQuotaCents: 0, withholdingsCents: eur(300), installmentsCents: 0, yearCode: "2026" }))).toEqual([
      ["refund", eur(300), 0],
      ["withholdings", 0, eur(300)],
    ]);
    expect(buildCorporateTaxEntryLines({ netQuotaCents: 0, withholdingsCents: 0, installmentsCents: 0, yearCode: "2026" })).toEqual([]);
  });

  it("impuesto diferido solo con diferencias temporarias", () => {
    expect(computeDeferredTax([adjustment("increase", 1_000)], 25)).toEqual({ assetChangeCents: 0, liabilityChangeCents: 0, expenseCents: 0 });
    const deferred = computeDeferredTax([
      adjustment("increase", 4_000, "temporaryOrigin"), // nace activo: 1.000
      adjustment("decrease", 10_000, "temporaryOrigin"), // nace pasivo: 2.500
      adjustment("decrease", 400, "temporaryReversal"), // revierte activo: −100
    ], 25);
    expect(deferred).toEqual({ assetChangeCents: eur(900), liabilityChangeCents: eur(2_500), expenseCents: eur(1_600) });
    const lines = buildCorporateTaxEntryLines({ netQuotaCents: eur(1_000), withholdingsCents: 0, installmentsCents: 0, deferred, yearCode: "2026" });
    expect(roles(lines)).toEqual([
      ["currentTax", eur(1_000), 0],
      ["payable", 0, eur(1_000)],
      ["deferredAsset", eur(900), 0],
      ["deferredLiability", 0, eur(2_500)],
      ["deferredTax", eur(1_600), 0],
    ]);
    expect(entryTotals(lines).debitCents).toBe(entryTotals(lines).creditCents);
  });

  it("reversión de un pasivo por impuesto diferido: 479 a 6301", () => {
    const deferred = computeDeferredTax([adjustment("increase", 2_000, "temporaryReversal")], 25);
    const lines = buildCorporateTaxEntryLines({ netQuotaCents: 0, withholdingsCents: 0, installmentsCents: 0, deferred, yearCode: "2026" });
    expect(roles(lines)).toEqual([
      ["deferredLiability", eur(500), 0],
      ["deferredTax", 0, eur(500)],
    ]);
  });
});

describe("propuesta de exceso de amortización", () => {
  it("compara la dotación con el coeficiente máximo prorrateado por los días en uso", () => {
    // Bien de 10.000 € al 25 % contable; máximo fiscal 10 % → exceso de 1.500.
    expect(depreciationExcessCents({ yearDepreciationCents: eur(2_500), depreciableCents: eur(10_000), maxPct: 10, daysInUse: 365, daysInYear: 365 })).toBe(eur(1_500));
    // Medio año en uso: máximo fiscal 500.
    expect(depreciationExcessCents({ yearDepreciationCents: eur(1_250), depreciableCents: eur(10_000), maxPct: 10, daysInUse: 182.5, daysInYear: 365 })).toBe(eur(750));
    expect(depreciationExcessCents({ yearDepreciationCents: eur(800), depreciableCents: eur(10_000), maxPct: 10, daysInUse: 365, daysInYear: 365 })).toBe(0);
  });
});
