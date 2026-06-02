import { describe, expect, it } from "vitest";

import { isValidSpanishTaxId, normalizeSpanishTaxId } from "@/lib/spanish-tax-id";

describe("Spanish tax id validation", () => {
  it("normalizes spacing, separators and casing", () => {
    expect(normalizeSpanishTaxId(" 12345678-z ")).toBe("12345678Z");
    expect(normalizeSpanishTaxId("b-99286320")).toBe("B99286320");
  });

  it("validates NIF, NIE and CIF control characters", () => {
    expect(isValidSpanishTaxId("12345678Z")).toBe(true);
    expect(isValidSpanishTaxId("X2482300W")).toBe(true);
    expect(isValidSpanishTaxId("B99286320")).toBe(true);
  });

  it("rejects invalid Spanish tax ids", () => {
    expect(isValidSpanishTaxId("12345678A")).toBe(false);
    expect(isValidSpanishTaxId("X2482300A")).toBe(false);
    expect(isValidSpanishTaxId("B99286321")).toBe(false);
    expect(isValidSpanishTaxId("")).toBe(false);
  });
});
