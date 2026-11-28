import { describe, expect, it } from "vitest";

import { computeCorporateTax } from "@/server/corporate-tax/liquidation";
import { formatModel200Box, LIQUIDATION_BOXES, model200BoxesWarning, STATEMENT_BOXES, taxRateBoxValue } from "@/server/corporate-tax/model-200-boxes";
import { liquidationRows, summaryWorkbookRows } from "@/server/corporate-tax/summary";

const result = computeCorporateTax({
  accountingResultBeforeTaxCents: 100_000_00,
  adjustments: [{ id: "a", kind: "fines", concept: "Multa de tráfico", sign: "increase", amountCents: 1_000_00, nature: "permanent" }],
  capitalizationReserveCents: 0,
  losses: [{ originYear: 2022, pendingCents: 10_000_00 }],
  lossCompensationCents: null,
  levelingReductionCents: 0,
  levelingAdditionCents: 0,
  regime: "general",
  startYear: 2025,
  credits: [],
  withholdingsCents: 500_00,
  installmentsCents: 2_000_00,
});
const view = { year: { code: "2025", start: "2025-01-01", end: "2025-12-31" }, inputs: { adjustments: [{ id: "a", kind: "fines", concept: "Multa de tráfico", sign: "increase" as const, amountCents: 1_000_00, nature: "permanent" as const }], credits: [] }, result };

describe("casillas del modelo 200", () => {
  it("numera las líneas de la liquidación con su página", () => {
    const rows = liquidationRows(view);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(formatModel200Box(byKey.get("accounting-result")?.box)).toBe("00501 (pág. 12)");
    expect(byKey.get("prior-base")?.box?.box).toBe("00550");
    expect(byKey.get("losses")?.box?.box).toBe("00547");
    expect(byKey.get("taxable-base")?.box?.box).toBe("00552");
    expect(byKey.get("gross-quota")?.box?.box).toBe("00562");
    expect(byKey.get("net-quota")?.box).toEqual({ page: "14 bis", box: "00592" });
    expect(byKey.get("differential")?.box?.box).toBe("00611");
    // Multas: casilla propia del detalle de correcciones (art. 15.c).
    expect(byKey.get("adj-a")?.box?.box).toBe("01815");
  });

  it("añade la cuota del ejercicio [00599] = cuota líquida − retenciones", () => {
    const row = liquidationRows(view).find((entry) => entry.key === "quota-of-year");
    expect(row?.cents).toBe(result.netQuotaCents - 500_00);
    expect(row?.box?.box).toBe("00599");
    expect(LIQUIDATION_BOXES.withholdings.box).toBe("01766");
  });

  it("indica el contenido de la casilla del tipo de gravamen", () => {
    expect(taxRateBoxValue([25])).toBe("2500");
    expect(taxRateBoxValue([21, 22])).toBe("2122");
    expect(taxRateBoxValue([15, 15])).toBe("1500");
    expect(liquidationRows(view).find((row) => row.key === "bracket-0")?.label).toContain("«2500»");
  });

  it("numera los epígrafes del balance y de la cuenta de pérdidas y ganancias", () => {
    expect(STATEMENT_BOXES.TOTAL_ACTIVO).toEqual({ page: "4", box: "00180" });
    expect(STATEMENT_BOXES["PG.1"]).toEqual({ page: "7", box: "00255" });
    expect(STATEMENT_BOXES["PG.C"]).toEqual({ page: "8", box: "00325" });
    // «Otros deudores» agrupa varias casillas del modelo normal: sin número.
    expect(STATEMENT_BOXES["B.III.3"]).toBeUndefined();
  });

  it("lleva la casilla a la hoja de cálculo", () => {
    const statements = { model: "abbreviated" as const, assets: [{ id: "TOTAL_ACTIVO", label: "TOTAL ACTIVO", depth: 0, kind: "total" as const, amount: 10, previous: null, accounts: [] }], equityAndLiabilities: [], incomeStatement: [], totals: { assets: 10, equityAndLiabilities: 10, result: 0 }, difference: 0, unmapped: [] };
    const rows = summaryWorkbookRows(view, { statements, previousYearCode: null });
    expect(rows.find((row) => row[0] === "Base imponible")?.[2]).toBe("00552 (pág. 14)");
    expect(rows.find((row) => row[0] === "TOTAL ACTIVO")?.[3]).toBe("00180 (pág. 4)");
  });

  it("avisa fuera del ejercicio contrastado", () => {
    expect(model200BoxesWarning(2025)).toBeNull();
    expect(model200BoxesWarning(2026)).toContain("2025");
  });
});
