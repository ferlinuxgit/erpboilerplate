import { describe, expect, it } from "vitest";

import {
  aggregateOutputVat,
  aggregateSurcharges,
  aggregateWithholdings,
  getDaysUntilDue,
  getFiscalDueStatus,
  getSpanishFiscalDueDate,
  normalizeSpanishFiscalPeriod,
  parseSpanishFiscalPeriod,
} from "@/lib/fiscal-spain";

describe("Spanish fiscal periods", () => {
  it("parses quarterly IVA periods", () => {
    const range = parseSpanishFiscalPeriod("2026-Q2", "303");

    expect(range?.label).toBe("2026 T2");
    expect(range?.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(range?.endExclusive.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("parses monthly IVA periods", () => {
    const range = parseSpanishFiscalPeriod("2026-04", "303");

    expect(range?.label).toBe("2026-04");
    expect(range?.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(range?.endExclusive.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("requires annual periods for annual models", () => {
    expect(normalizeSpanishFiscalPeriod("2026", "390")).toBe("2026");
    expect(normalizeSpanishFiscalPeriod("2026-Q1", "390")).toBeNull();
  });

  it("computes Spanish filing due dates", () => {
    expect(getSpanishFiscalDueDate("2026-Q4", "303")?.toISOString()).toBe("2027-01-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026-Q4", "111")?.toISOString()).toBe("2027-01-20T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026", "390")?.toISOString()).toBe("2027-01-30T00:00:00.000Z");
    expect(getSpanishFiscalDueDate("2026", "347")?.toISOString()).toBe("2027-02-28T00:00:00.000Z");
  });

  it("labels due status from a reference day", () => {
    const now = new Date(Date.UTC(2026, 0, 15));

    expect(getDaysUntilDue(new Date(Date.UTC(2026, 0, 20)), now)).toBe(5);
    expect(getFiscalDueStatus(new Date(Date.UTC(2026, 0, 20)), now)).toBe("due-soon");
    expect(getFiscalDueStatus(new Date(Date.UTC(2026, 0, 14)), now)).toBe("overdue");
  });
});

describe("Spanish fiscal aggregation (bucket rounding)", () => {
  const smallLines = [0, 1, 2].map(() => ({ quantity: "1", unitPrice: "0.35", taxRate: "21", retentionRate: "15" }));

  it("computes VAT on the summed base per rate", () => {
    // Línea a línea serían 0,07 × 3 = 0,21; sobre la base del tipo (1,05) la cuota es 0,22.
    expect(aggregateOutputVat(smallLines)).toEqual([{ rate: 21, base: 1.05, tax: 0.22 }]);
  });

  it("keeps partial deductibility per line group within a rate bucket", () => {
    expect(aggregateOutputVat([
      { quantity: 1, unitPrice: 100, taxRate: 21 },
      { quantity: 1, unitPrice: 100, taxRate: 21, taxDeductiblePct: 50 },
    ])).toEqual([{ rate: 21, base: 200, tax: 31.5 }]);
  });

  it("nets negative lines (rectificativas) inside the bucket", () => {
    expect(aggregateOutputVat([
      { quantity: 3, unitPrice: 100, taxRate: 21 },
      { quantity: -1, unitPrice: 100, taxRate: 21 },
    ])).toEqual([{ rate: 21, base: 200, tax: 42 }]);
  });

  it("computes surcharges and withholdings on the bucket base", () => {
    const surchargeLines = smallLines.map((line) => ({
      ...line,
      taxes: [
        { rate: 21, kind: "VAT", operation: "ADD" as const },
        { rate: 5.2, kind: "SURCHARGE", operation: "ADD" as const },
      ],
    }));
    expect(aggregateSurcharges(surchargeLines)).toEqual([{ rate: 5.2, base: 1.05, tax: 0.05 }]);
    expect(aggregateWithholdings(smallLines)).toEqual([{ rate: 15, base: 1.05, tax: 0.16 }]);
  });
});
