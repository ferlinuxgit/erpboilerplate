import { describe, expect, it } from "vitest";

import { buildSupplierIdentityKey, normalizeSupplierDocumentNumber, normalizeSupplierName, normalizeTaxIdentity } from "./expense-dedup";

describe("expense duplicate canonicalization", () => {
  it("maps common visual variants of an invoice number to the same key", () => {
    expect(normalizeSupplierDocumentNumber(" F-2026/001 ")).toBe("F2026001");
    expect(normalizeSupplierDocumentNumber("f 2026.001")).toBe("F2026001");
    expect(normalizeSupplierDocumentNumber("Ｆ－２０２６／００１")).toBe("F2026001");
  });

  it("uses country and normalized tax id as supplier identity", () => {
    expect(normalizeTaxIdentity(" ES B-123.45674 ")).toBe("ESB12345674");
    expect(normalizeTaxIdentity("ES B-123.45674", "ES")).toBe("B12345674");
    expect(buildSupplierIdentityKey({ partnerId: "p-1", countryCode: "es", taxId: "B-12345674" })).toBe("tax:ES:B12345674");
    expect(buildSupplierIdentityKey({ partnerId: "p-1" })).toBe("partner:p-1");
  });

  it("falls back to a conservative canonical supplier name when no tax id exists", () => {
    expect(normalizeSupplierName("  Cafés Álamo, S.L. ")).toBe("CAFESALAMOSL");
    expect(buildSupplierIdentityKey({ partnerId: "p-1", countryCode: "ES", name: "Cafés Álamo SL" })).toBe("name:ES:CAFESALAMOSL");
  });
});
