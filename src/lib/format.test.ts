import { describe, expect, it } from "vitest";

import { formatAmount, formatDate, formatMoney, formatPercent } from "@/lib/format";

describe("format helpers", () => {
  it("formatea moneda en euros", () => {
    expect(formatMoney(10.5, "EUR", "es-ES")).toContain("10");
  });

  it("formatea importes y porcentajes con coma decimal", () => {
    expect(formatAmount(1234.5)).toBe("1234,50");
    expect(formatAmount("-0.1")).toBe("-0,10");
    expect(formatPercent("21.00")).toBe("21 %");
    expect(formatPercent(5.25)).toBe("5,25 %");
  });

  it("formatea fecha", () => {
    expect(formatDate(new Date("2026-01-01T00:00:00.000Z"), "es-ES")).toContain("2026");
  });
});
