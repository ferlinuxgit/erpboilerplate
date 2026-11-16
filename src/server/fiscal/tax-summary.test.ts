import { describe, expect, it } from "vitest";

import { parseTaxSummaryPeriod, recentTaxSummaryPeriods, taxSummaryPeriodKey } from "@/server/fiscal/tax-summary-periods";

describe("periodos del resumen de impuestos", () => {
  it("interpreta trimestres y meses como rangos UTC [inicio, fin)", () => {
    expect(parseTaxSummaryPeriod("2026-q3")).toEqual({
      key: "2026-Q3",
      label: "3.º trimestre 2026",
      start: new Date(Date.UTC(2026, 6, 1)),
      endExclusive: new Date(Date.UTC(2026, 9, 1)),
    });
    expect(parseTaxSummaryPeriod("2026-12")?.endExclusive).toEqual(new Date(Date.UTC(2027, 0, 1)));
    expect(parseTaxSummaryPeriod("2026")).toBeNull();
    expect(parseTaxSummaryPeriod(undefined)).toBeNull();
  });

  it("propone el periodo en curso y los anteriores", () => {
    const now = new Date(Date.UTC(2026, 10, 16));
    expect(taxSummaryPeriodKey(now, "quarterly")).toBe("2026-Q4");
    expect(taxSummaryPeriodKey(now, "monthly")).toBe("2026-11");
    expect(recentTaxSummaryPeriods(now, "quarterly", 5).map((period) => period.key)).toEqual(["2026-Q4", "2026-Q3", "2026-Q2", "2026-Q1", "2025-Q4"]);
    expect(recentTaxSummaryPeriods(now, "monthly", 3).map((period) => period.key)).toEqual(["2026-11", "2026-10", "2026-09"]);
  });
});
