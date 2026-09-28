import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { genericPartyGroup, referenceTokens, supplierKindFromHistory } from "@/server/accounting/reclassify";
import {
  canonicalSubaccountCode,
  defaultSupplierKind,
  isCanonicalSubaccountCode,
  nearestAncestorCode,
  nextFreePartnerSubaccountCode,
  normalizeSubaccountLength,
  partnerAccountPrefix,
  partnerSequenceFromNumber,
  partnerSubaccountCode,
  sameCanonicalAccount,
} from "@/server/accounting/subaccounts-model";

describe("subcuentas (reglas puras)", () => {
  it.each([8, 9, 10, 11, 12])("completa con ceros hasta %i dígitos y rechaza códigos no válidos", (length) => {
    expect(canonicalSubaccountCode("477", length)).toBe(`477${"0".repeat(length - 3)}`);
    expect(canonicalSubaccountCode("4751", length)).toBe(`4751${"0".repeat(length - 4)}`);
    expect(canonicalSubaccountCode("700000", length)).toBe(`7${"0".repeat(length - 1)}`);
    expect(canonicalSubaccountCode(" 572 ", length)).toHaveLength(length);
    expect(canonicalSubaccountCode("47A", length)).toBeNull();
    expect(canonicalSubaccountCode("1".repeat(length + 1), length)).toBeNull();
    expect(isCanonicalSubaccountCode("4".repeat(length), length)).toBe(true);
    expect(isCanonicalSubaccountCode("477", length)).toBe(false);
  });

  it("normaliza la longitud de subcuenta a 8–12", () => {
    expect(normalizeSubaccountLength(10)).toBe(10);
    expect(normalizeSubaccountLength(7)).toBe(8);
    expect(normalizeSubaccountLength("13")).toBe(8);
    expect(normalizeSubaccountLength(null)).toBe(8);
  });

  it("numera las subcuentas de terceros con el número del tercero y busca la siguiente libre", () => {
    expect(partnerSequenceFromNumber("CL000012")).toBe(12);
    expect(partnerSequenceFromNumber("SIN-NUMERO")).toBeNull();
    expect(partnerSubaccountCode("430", 1, 8)).toBe("43000001");
    expect(partnerSubaccountCode("410", 12, 10)).toBe("4100000012");
    expect(partnerSubaccountCode("430", 100000, 8)).toBeNull();
    expect(nextFreePartnerSubaccountCode("430", 8, ["43000000", "43000007", "4300", "40000009"])).toBe("43000008");
    expect(nextFreePartnerSubaccountCode("430", 8, ["43099999"])).toBeNull();
  });

  it("elige 430 para clientes y 400/410 para proveedores según su tipo o la actividad de la empresa", () => {
    expect(partnerAccountPrefix({ role: "customer", supplierKind: "GOODS", countryCode: "ES" })).toBe("430");
    expect(partnerAccountPrefix({ role: "supplier", supplierKind: "GOODS", countryCode: "ES" })).toBe("400");
    expect(partnerAccountPrefix({ role: "supplier", supplierKind: "SERVICES", countryCode: "ES" })).toBe("410");
    expect(partnerAccountPrefix({ role: "customer", supplierKind: "GOODS", countryCode: "US", customerCode: "1100" })).toBe("110");
    expect(defaultSupplierKind("services")).toBe("SERVICES");
    expect(defaultSupplierKind("products")).toBe("GOODS");
    expect(defaultSupplierKind("both")).toBe("GOODS");
  });

  it("encuentra la cuenta padre más cercana y compara subcuentas canónicas", () => {
    expect(nearestAncestorCode("43000001", ["4", "43", "430", "4300"])).toBe("4300");
    expect(nearestAncestorCode("12900000", ["1", "12"])).toBe("12");
    expect(nearestAncestorCode("9", ["1"])).toBeNull();
    expect(sameCanonicalAccount("572", "57200000")).toBe(true);
    expect(sameCanonicalAccount("572", "57200001")).toBe(false);
  });
});

describe("reclasificación (reglas puras)", () => {
  it("solo las cuentas de control genéricas de clientes y proveedores se reparten por tercero", () => {
    expect(genericPartyGroup("430")).toBe("430");
    expect(genericPartyGroup("4300")).toBe("430");
    expect(genericPartyGroup("430000")).toBe("430");
    expect(genericPartyGroup("43000000")).toBe("430");
    expect(genericPartyGroup("4100")).toBe("410");
    expect(genericPartyGroup("400000")).toBe("400");
    expect(genericPartyGroup("4309")).toBeNull();
    expect(genericPartyGroup("43000001")).toBeNull();
    expect(genericPartyGroup("477")).toBeNull();
  });

  it("deduce el tipo de proveedor por la mayoría de sus cuentas de gasto", () => {
    expect(supplierKindFromHistory(["600", "60000000", "629"], "services")).toBe("GOODS");
    expect(supplierKindFromHistory(["629", "62300000"], "products")).toBe("SERVICES");
    expect(supplierKindFromHistory(["600", "629"], "services")).toBe("SERVICES");
    expect(supplierKindFromHistory([], "products")).toBe("GOODS");
  });

  it("extrae números de documento e ids de las referencias antiguas", () => {
    expect(referenceTokens("Cobro factura FA000049")).toEqual(["Cobro", "factura", "FA000049"]);
    expect(referenceTokens("Pago a cuenta de proveedor 1b2c-3d")).toContain("1b2c-3d");
    expect(referenceTokens(null)).toEqual([]);
  });
});
