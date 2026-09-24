import { describe, expect, it } from "vitest";

import { describeSpanishTaxIdProblem, hasSpanishTaxIdFormat, isValidSpanishTaxId, normalizeSpanishTaxId } from "@/lib/spanish-tax-id";

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

  it("recognizes structure without treating a local checksum as census verification", () => {
    expect(hasSpanishTaxIdFormat("B88265391")).toBe(true);
    expect(hasSpanishTaxIdFormat("ESB88265391")).toBe(true);
    expect(hasSpanishTaxIdFormat("B8826")).toBe(false);
  });

  it("explains incomplete ids and suggests the complete value", () => {
    expect(describeSpanishTaxIdProblem("B02309870")).toBeNull();
    expect(describeSpanishTaxIdProblem("B0230987")).toContain("el CIF completo sería B02309870");
    expect(isValidSpanishTaxId("B02309870")).toBe(true);
    // K, P, Q and S entities use a control letter.
    expect(describeSpanishTaxIdProblem("Q2826000")).toMatch(/Q2826000[A-J]\./);
    expect(describeSpanishTaxIdProblem("12345678")).toContain("12345678Z");
    expect(describeSpanishTaxIdProblem("X2482300")).toContain("X2482300W");
    expect(describeSpanishTaxIdProblem("1234567Z")).toContain("01234567Z");
    expect(describeSpanishTaxIdProblem("B8826")).toContain("Un CIF tiene 9 caracteres");
  });
});
