import { describe, expect, it } from "vitest";

import { getDaysUntilDue, getFiscalDueStatus, getSpanishFiscalDueDate, normalizeSpanishFiscalPeriod, parseSpanishFiscalPeriod } from "@/lib/fiscal-spain";

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
