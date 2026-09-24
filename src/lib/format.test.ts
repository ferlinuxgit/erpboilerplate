import { describe, expect, it } from "vitest";

import { formatAmount, formatDate, formatDecimalInput, formatMoney, formatPercent, parseDecimalInput } from "@/lib/format";

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

describe("parseDecimalInput", () => {
  it("acepta formato español y formato con punto decimal", () => {
    expect(parseDecimalInput("1.234,56")).toBe(1234.56);
    expect(parseDecimalInput("1234,56")).toBe(1234.56);
    expect(parseDecimalInput("1234.56")).toBe(1234.56);
    expect(parseDecimalInput("1,234.56")).toBe(1234.56);
    expect(parseDecimalInput("1.234.567")).toBe(1234567);
    expect(parseDecimalInput(" 1.234,56 € ")).toBe(1234.56);
    expect(parseDecimalInput("21 %")).toBe(21);
    expect(parseDecimalInput("-0,5")).toBe(-0.5);
    expect(parseDecimalInput(",5")).toBe(0.5);
  });

  it("interpreta un único punto como decimal salvo en importes con tres cifras", () => {
    expect(parseDecimalInput("2.125")).toBe(2.125);
    expect(parseDecimalInput("2.000")).toBe(2);
    expect(parseDecimalInput("1.500", { maximumFractionDigits: 2 })).toBe(1500);
    expect(parseDecimalInput("1.50", { maximumFractionDigits: 2 })).toBe(1.5);
    // Percent fields parse with 3 decimals: stored rates like "21.000" stay 21.
    expect(parseDecimalInput("21.000", { maximumFractionDigits: 3 })).toBe(21);
    expect(parseDecimalInput("5.125", { maximumFractionDigits: 3 })).toBe(5.125);
  });

  it("devuelve null para vacío o texto no numérico", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput("1,2,3a")).toBeNull();
    expect(parseDecimalInput(undefined)).toBeNull();
    expect(parseDecimalInput(3)).toBe(3);
  });
});

describe("formatDecimalInput", () => {
  it("formatea para campos editables en es-ES", () => {
    expect(formatDecimalInput(12345.6, { minimumFractionDigits: 2 })).toBe("12.345,60");
    expect(formatDecimalInput(1.5, { maximumFractionDigits: 3 })).toBe("1,5");
    expect(formatDecimalInput(null)).toBe("");
  });
});
