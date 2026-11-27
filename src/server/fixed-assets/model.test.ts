import { describe, expect, it } from "vitest";

import { assetCostFromInvoiceLineCents, assetStatusFor, buildDisposalLines, buildRegisterRows, effectiveAnnualPct, nextAssetCode, suggestAssetAccounts, validateAssetRules, type AssetRulesInput, type RegisterAsset } from "@/server/fixed-assets/model";
import { planAssetPostings, FISCAL_PERIOD_LOCKED } from "@/server/fixed-assets/posting-plan";
import { findTaxCoefficient, suggestedTaxCoefficientKey, TAX_COEFFICIENTS, taxCoefficientWarning } from "@/server/fixed-assets/tax-coefficients";

describe("correspondencia de cuentas del PGC", () => {
  it.each([
    ["200", "2800", "680"],
    ["203", "2803", "680"],
    ["204", "2804", "680"],
    ["206", "2806", "680"],
    ["211", "2811", "681"],
    ["213", "2813", "681"],
    ["216", "2816", "681"],
    ["21700001", "2817", "681"],
    ["218", "2818", "681"],
    ["219", "2819", "681"],
    ["221", "282", "682"],
  ])("%s → %s y %s", (asset, accumulated, expense) => {
    expect(suggestAssetAccounts(asset)).toMatchObject({ depreciable: true, accumulatedCode: accumulated, expenseCode: expense });
  });

  it("terrenos y anticipos no se amortizan", () => {
    for (const code of ["210", "220", "209"]) {
      expect(suggestAssetAccounts(code)).toMatchObject({ depreciable: false, accumulatedCode: null, expenseCode: null });
    }
  });

  it("cuentas que no son de inmovilizado", () => {
    expect(suggestAssetAccounts("230")).toBeNull();
    expect(suggestAssetAccounts("572")).toBeNull();
    expect(suggestAssetAccounts("21")).toBeNull();
  });
});

describe("reglas de la ficha", () => {
  const valid: AssetRulesInput = {
    assetAccountCode: "217",
    accumulatedAccountCode: "2817",
    expenseAccountCode: "681",
    isDepreciable: true,
    method: "percent",
    annualPct: 25,
    acquisitionDate: "2025-01-10",
    inServiceDate: "2025-01-15",
    acquisitionCostCents: 120_000,
    residualValueCents: 0,
    priorAccumulatedCents: 0,
  };

  it("ficha correcta", () => {
    expect(validateAssetRules(valid)).toBeNull();
    expect(validateAssetRules({ ...valid, method: "years", annualPct: null, usefulLifeYears: 4 })).toBeNull();
    expect(validateAssetRules({ ...valid, assetAccountCode: "210", isDepreciable: false, accumulatedAccountCode: null, expenseAccountCode: null, annualPct: null })).toBeNull();
  });

  it("errores", () => {
    expect(validateAssetRules({ ...valid, assetAccountCode: "600" })).toMatch(/inmovilizado/);
    expect(validateAssetRules({ ...valid, residualValueCents: 120_000 })).toMatch(/residual/);
    expect(validateAssetRules({ ...valid, inServiceDate: "2025-01-01" })).toMatch(/puesta en funcionamiento/);
    expect(validateAssetRules({ ...valid, accumulatedAccountCode: "681" })).toMatch(/amortización acumulada/);
    expect(validateAssetRules({ ...valid, expenseAccountCode: "2817" })).toMatch(/gasto/);
    expect(validateAssetRules({ ...valid, annualPct: null })).toMatch(/porcentaje/);
    expect(validateAssetRules({ ...valid, annualPct: 150 })).toMatch(/0,5 %/);
    expect(validateAssetRules({ ...valid, priorAccumulatedCents: 130_000, depreciationStartDate: "2026-01-01" })).toMatch(/acumulada anterior/);
    expect(validateAssetRules({ ...valid, priorAccumulatedCents: 30_000 })).toMatch(/desde qué fecha/);
    expect(validateAssetRules({ ...valid, depreciationStartDate: "2024-12-31" })).toMatch(/inicio de la amortización/);
  });

  it("porcentaje efectivo y estado", () => {
    expect(effectiveAnnualPct({ method: "years", usefulLifeYears: 8 })).toBe(12.5);
    expect(effectiveAnnualPct({ method: "percent", annualPct: 10 })).toBe(10);
    expect(effectiveAnnualPct({ method: "percent", annualPct: null })).toBeNull();
    expect(assetStatusFor({ disposed: false, isDepreciable: true, depreciableCents: 100, accumulatedCents: 100 })).toBe("fully_depreciated");
    expect(assetStatusFor({ disposed: false, isDepreciable: true, depreciableCents: 100, accumulatedCents: 99 })).toBe("active");
    expect(assetStatusFor({ disposed: true, isDepreciable: true, depreciableCents: 100, accumulatedCents: 100 })).toBe("disposed");
    expect(assetStatusFor({ disposed: false, isDepreciable: false, depreciableCents: 0, accumulatedCents: 0 })).toBe("active");
  });

  it("código correlativo", () => {
    expect(nextAssetCode([])).toBe("BI-0001");
    expect(nextAssetCode(["BI-0001", "BI-0009", "otro"])).toBe("BI-0010");
  });
});

describe("asiento de baja o venta", () => {
  const totals = (lines: ReturnType<typeof buildDisposalLines>["lines"]) => [lines.reduce((sum, line) => sum + line.debitCents, 0), lines.reduce((sum, line) => sum + line.creditCents, 0)];

  it("venta con beneficio", () => {
    const { lines, resultCents } = buildDisposalLines({ costCents: 100_000, accumulatedCents: 60_000, proceedsCents: 50_000 });
    expect(resultCents).toBe(10_000);
    expect(lines).toEqual([
      { role: "accumulated", debitCents: 60_000, creditCents: 0 },
      { role: "proceeds", debitCents: 50_000, creditCents: 0 },
      { role: "asset", debitCents: 0, creditCents: 100_000 },
      { role: "gain", debitCents: 0, creditCents: 10_000 },
    ]);
    const [debit, credit] = totals(lines);
    expect(debit).toBe(credit);
  });

  it("venta con pérdida", () => {
    const { lines, resultCents } = buildDisposalLines({ costCents: 100_000, accumulatedCents: 60_000, proceedsCents: 25_000 });
    expect(resultCents).toBe(-15_000);
    expect(lines.find((line) => line.role === "loss")).toEqual({ role: "loss", debitCents: 15_000, creditCents: 0 });
    const [debit, credit] = totals(lines);
    expect(debit).toBe(credit);
  });

  it("baja sin cobro: el valor neto es pérdida; totalmente amortizado, sin resultado", () => {
    expect(buildDisposalLines({ costCents: 100_000, accumulatedCents: 60_000, proceedsCents: 0 }).lines.map((line) => line.role)).toEqual(["accumulated", "loss", "asset"]);
    const full = buildDisposalLines({ costCents: 100_000, accumulatedCents: 100_000, proceedsCents: 0 });
    expect(full.resultCents).toBe(0);
    expect(full.lines.map((line) => line.role)).toEqual(["accumulated", "asset"]);
  });

  it("terreno (sin amortización) vendido por su valor", () => {
    const { lines, resultCents } = buildDisposalLines({ costCents: 100_000, accumulatedCents: 0, proceedsCents: 100_000 });
    expect(resultCents).toBe(0);
    expect(lines.map((line) => line.role)).toEqual(["proceeds", "asset"]);
  });
});

describe("contabilización respetando bloqueos", () => {
  const pending = [
    { start: "2025-01-01", end: "2025-01-31", amountCents: 100, label: "enero de 2025", fiscalEnd: "2025-12-31" },
    { start: "2025-02-01", end: "2025-02-28", amountCents: 100, label: "febrero de 2025", fiscalEnd: "2025-12-31" },
    { start: "2025-03-01", end: "2025-03-31", amountCents: 100, label: "marzo de 2025", fiscalEnd: "2025-12-31" },
    { start: "2025-04-01", end: "2025-04-30", amountCents: 100, label: "abril de 2025", fiscalEnd: "2025-12-31" },
  ];
  const locked = (dates: string[], code = FISCAL_PERIOD_LOCKED) => async (date: string) => (dates.includes(date) ? { code, message: `bloqueado ${date}` } : null);

  it("todo abierto: un asiento por periodo", async () => {
    const plan = await planAssetPostings(pending, locked([]));
    expect(plan.blocked).toBeNull();
    expect(plan.postings.map((posting) => [posting.end, posting.amountCents])).toEqual([["2025-01-31", 100], ["2025-02-28", 100], ["2025-03-31", 100], ["2025-04-30", 100]]);
  });

  it("trimestre con el IVA presentado: su cuota pasa al primer periodo abierto del mismo ejercicio", async () => {
    const plan = await planAssetPostings(pending, locked(["2025-01-31", "2025-02-28", "2025-03-31"]));
    expect(plan.blocked).toBeNull();
    expect(plan.postings).toEqual([{ start: "2025-01-01", end: "2025-04-30", amountCents: 400, label: "abril de 2025", carriedCents: 300 }]);
  });

  it("si no queda periodo abierto en el ejercicio, se informa y no se pasa al siguiente", async () => {
    const nextYear = { start: "2026-01-01", end: "2026-01-31", amountCents: 100, label: "enero de 2026", fiscalEnd: "2026-12-31" };
    const plan = await planAssetPostings([...pending.slice(0, 3), nextYear], locked(["2025-03-31"]));
    expect(plan.postings.map((posting) => posting.end)).toEqual(["2025-01-31", "2025-02-28"]);
    expect(plan.blocked).toEqual({ amountCents: 100, periodEnd: "2025-03-31", reason: "bloqueado 2025-03-31" });
  });

  it("ejercicio cerrado: el bien se detiene en ese periodo", async () => {
    const plan = await planAssetPostings(pending, locked(["2025-02-28"], "FISCAL_YEAR_CLOSED"));
    expect(plan.postings.map((posting) => posting.end)).toEqual(["2025-01-31"]);
    expect(plan.blocked).toEqual({ amountCents: 100, periodEnd: "2025-02-28", reason: "bloqueado 2025-02-28" });
  });
});

describe("libro registro de bienes de inversión", () => {
  const base: RegisterAsset = {
    code: "BI-0001",
    description: "Portátil",
    assetAccountCode: "21700000",
    acquisitionDate: "2024-03-01",
    inServiceDate: "2024-03-01",
    costCents: 120_000,
    residualCents: 0,
    annualPct: 25,
    priorAccumulatedCents: 0,
    disposalDate: null,
    disposalProceedsCents: null,
    postings: [
      { periodEnd: "2024-12-31", amountCents: 25_000 },
      { periodEnd: "2025-12-31", amountCents: 30_000 },
    ],
  };

  it("amortización del ejercicio y acumulada al cierre", () => {
    const [row] = buildRegisterRows([base], { start: "2025-01-01", end: "2025-12-31" });
    expect(row).toMatchObject({ yearDepreciationCents: 30_000, accumulatedCents: 55_000, netBookValueCents: 65_000, disposalDate: null });
    const [previous] = buildRegisterRows([base], { start: "2024-01-01", end: "2024-12-31" });
    expect(previous).toMatchObject({ yearDepreciationCents: 25_000, accumulatedCents: 25_000 });
  });

  it("excluye bienes adquiridos después del ejercicio o dados de baja antes", () => {
    const later = { ...base, code: "BI-0002", acquisitionDate: "2026-01-10", inServiceDate: "2026-01-10", postings: [] };
    const gone = { ...base, code: "BI-0003", disposalDate: "2024-06-30", disposalProceedsCents: 0, postings: [] };
    expect(buildRegisterRows([base, later, gone], { start: "2025-01-01", end: "2025-12-31" }).map((row) => row.code)).toEqual(["BI-0001"]);
  });

  it("baja dentro del ejercicio: muestra fecha e importe y valor neto cero", () => {
    const sold = { ...base, disposalDate: "2025-06-30", disposalProceedsCents: 50_000, postings: [{ periodEnd: "2024-12-31", amountCents: 25_000 }, { periodEnd: "2025-06-30", amountCents: 14_877 }] };
    const [row] = buildRegisterRows([sold], { start: "2025-01-01", end: "2025-12-31" });
    expect(row).toMatchObject({ yearDepreciationCents: 14_877, accumulatedCents: 39_877, netBookValueCents: 0, disposalDate: "2025-06-30", disposalProceedsCents: 50_000 });
    // En el ejercicio anterior todavía no consta la baja.
    expect(buildRegisterRows([sold], { start: "2024-01-01", end: "2024-12-31" })[0].disposalDate).toBeNull();
  });
});

describe("tabla fiscal de coeficientes (art. 12.1.a LIS)", () => {
  it("claves únicas y periodo coherente con el coeficiente", () => {
    expect(new Set(TAX_COEFFICIENTS.map((entry) => entry.key)).size).toBe(TAX_COEFFICIENTS.length);
    expect(TAX_COEFFICIENTS).toHaveLength(33);
    for (const entry of TAX_COEFFICIENTS) {
      expect(entry.maxPct).toBeGreaterThan(0);
      // El coeficiente mínimo (100 ÷ periodo máximo) nunca supera el máximo.
      expect(100 / entry.maxYears).toBeLessThanOrEqual(entry.maxPct);
    }
    expect(findTaxCoefficient("equipos-informaticos")).toMatchObject({ maxPct: 25, maxYears: 8 });
    expect(findTaxCoefficient("mobiliario")).toMatchObject({ maxPct: 10, maxYears: 20 });
    expect(findTaxCoefficient("transporte-externo")).toMatchObject({ maxPct: 16, maxYears: 14 });
  });

  it("propone el tipo de elemento por la cuenta", () => {
    expect(suggestedTaxCoefficientKey("21700000")).toBe("equipos-informaticos");
    expect(suggestedTaxCoefficientKey("206")).toBe("programas-informaticos");
    expect(suggestedTaxCoefficientKey("210")).toBeNull();
  });

  it("avisa sin bloquear si el porcentaje se sale del rango fiscal", () => {
    expect(taxCoefficientWarning(25, "equipos-informaticos")).toBeNull();
    expect(taxCoefficientWarning(33, "equipos-informaticos")).toMatch(/supera el coeficiente máximo fiscal del 25 %/);
    expect(taxCoefficientWarning(5, "equipos-informaticos")).toMatch(/periodo máximo fiscal de 8 años/);
    expect(taxCoefficientWarning(50, null)).toBeNull();
  });
});

describe("precio de adquisición desde la línea de la factura de compra", () => {
  it("con IVA totalmente deducible es la base", () => {
    expect(assetCostFromInvoiceLineCents({ subtotalAmount: "1000.00", taxAmount: "210.00", taxDeductiblePct: "100" })).toBe(100_000);
  });

  it("suma el IVA no deducible y el recargo de equivalencia", () => {
    expect(assetCostFromInvoiceLineCents({ subtotalAmount: "1000.00", taxAmount: "210.00", taxDeductiblePct: "50", vatTreatment: "DOMESTIC" })).toBe(110_500);
    expect(assetCostFromInvoiceLineCents({ subtotalAmount: "1000.00", taxAmount: "210.00", taxDeductiblePct: "0", surchargeAmount: "52.00" })).toBe(126_200);
  });

  it("con IVA autorrepercutido (intracomunitaria, inversión del sujeto pasivo) es la base", () => {
    expect(assetCostFromInvoiceLineCents({ subtotalAmount: "1000.00", taxAmount: "210.00", taxDeductiblePct: "0", vatTreatment: "INTRA_EU" })).toBe(100_000);
  });
});
