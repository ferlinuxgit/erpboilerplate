import { describe, expect, it } from "vitest";

import { defaultLineTaxIds, defaultVatRate, findRetentionTaxByRate, pickDefaultVatTax } from "@/server/invoices/default-taxes";

const taxes = [
  { id: "super", rate: "4.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true },
  { id: "reduced", rate: "10.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true },
  { id: "general", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true },
  { id: "irpf", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT", isDefault: true, isActive: true },
  { id: "re", rate: "5.200", kind: "SURCHARGE", operation: "ADD", isDefault: false, isActive: true },
];

describe("IVA por defecto", () => {
  it("nunca propone el tipo más bajo: sin predeterminado, el 21 %", () => {
    expect(pickDefaultVatTax(taxes)?.id).toBe("general");
    expect(defaultVatRate(taxes)).toBe(21);
  });

  it("respeta el IVA marcado como predeterminado (solo IVA repercutido)", () => {
    const flagged = taxes.map((tax) => (tax.id === "reduced" ? { ...tax, isDefault: true } : tax));
    expect(pickDefaultVatTax(flagged)?.id).toBe("reduced");
    // Una retención marcada como predeterminada no es IVA por defecto.
    expect(pickDefaultVatTax(taxes)?.id).not.toBe("irpf");
  });

  it("ignora impuestos archivados y, sin IVA configurado, usa el 21 %", () => {
    expect(pickDefaultVatTax(taxes.map((tax) => (tax.id === "general" ? { ...tax, isActive: false } : tax)))).toBeNull();
    expect(defaultVatRate([])).toBe(21);
  });

  it("propone IVA + recargo + IRPF habitual del cliente en las líneas nuevas", () => {
    expect(defaultLineTaxIds(taxes, null)).toEqual(["general"]);
    expect(defaultLineTaxIds(taxes, { defaultRetentionRate: 15 })).toEqual(["general", "irpf"]);
    expect(defaultLineTaxIds(taxes, { equivalenceSurcharge: true })).toEqual(["general", "re"]);
    expect(defaultLineTaxIds(taxes, { defaultRetentionRate: 15 }, { withVat: false })).toEqual(["irpf"]);
    expect(findRetentionTaxByRate(taxes, 7)).toBeNull();
  });
});
