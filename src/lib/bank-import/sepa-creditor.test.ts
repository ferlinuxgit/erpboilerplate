import { describe, expect, it } from "vitest";

import { buildCreditorId, checkCreditorId, creditorIdCheckDigits } from "@/lib/bank-import/sepa-creditor";

describe("identificador de acreedor SEPA", () => {
  it("valida el ejemplo oficial alemán (EPC)", () => {
    expect(checkCreditorId("DE98ZZZ09999999999")).toEqual({ valid: true, creditorId: "DE98ZZZ09999999999" });
  });

  it("construye y valida el de una sociedad española a partir del NIF", () => {
    const id = buildCreditorId("B12345678");
    expect(id).toMatch(/^ES\d{2}000B12345678$/);
    expect(id.slice(2, 4)).toBe(creditorIdCheckDigits("ES", "B12345678"));
    expect(checkCreditorId(id).valid).toBe(true);
    // El sufijo no interviene en los dígitos de control.
    expect(buildCreditorId("B12345678", "001").slice(2, 4)).toBe(id.slice(2, 4));
  });

  it("normaliza espacios y minúsculas", () => {
    const id = buildCreditorId("B12345678");
    expect(checkCreditorId(` ${id.slice(0, 4)} ${id.slice(4, 7).toLowerCase()} ${id.slice(7)} `).valid).toBe(true);
  });

  it("explica los errores en lenguaje llano", () => {
    const id = buildCreditorId("B12345678");
    const wrongDigits = `ES${id.slice(2, 4) === "00" ? "01" : "00"}${id.slice(4)}`;
    expect(checkCreditorId(wrongDigits)).toMatchObject({ valid: false, reason: expect.stringContaining("dígitos de control") });
    expect(checkCreditorId("ES12000B1234")).toMatchObject({ valid: false, reason: expect.stringContaining("16 caracteres") });
    expect(checkCreditorId("")).toMatchObject({ valid: false });
    expect(checkCreditorId("B12345678")).toMatchObject({ valid: false });
  });
});
