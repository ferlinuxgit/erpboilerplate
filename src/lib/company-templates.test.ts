import { describe, expect, it } from "vitest";

import { genericTemplateTaxes, getCompanyTemplate, hasCountrySpecificTemplate } from "@/lib/company-templates";

describe("company templates", () => {
  it("provides the Spanish template and a generic one for every other country", () => {
    expect(getCompanyTemplate("ES").label).toBe("Espana - General");
    expect(getCompanyTemplate("ES").id).toBe("ES_GENERAL");
    expect(getCompanyTemplate("US").id).toBe("GENERIC");
    expect(getCompanyTemplate("FR").label).toBe("General (Francia)");
    expect(hasCountrySpecificTemplate("ES")).toBe(true);
    expect(hasCountrySpecificTemplate("FR")).toBe(false);
  });

  it("loads the complete Spanish PGC catalog with official posting defaults", () => {
    const template = getCompanyTemplate("ES");
    expect(template?.accounts.length).toBe(895);
    expect(template?.settings.defaultCustomerAccountCode).toBe("4300");
    expect(template?.settings.defaultSupplierAccountCode).toBe("4100");
    expect(template?.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "1", isPostable: false }),
      expect.objectContaining({ code: "203", name: "Propiedad industrial", type: "ASSET", isPostable: true }),
      expect.objectContaining({ code: "2804", name: "Amortización acumulada de fondo de comercio", type: "ASSET", isPostable: true }),
      expect.objectContaining({ code: "406", name: "Envases y embalajes a devolver a proveedores", type: "LIABILITY", isPostable: true }),
      expect.objectContaining({ code: "4300", isPostable: true }),
      expect.objectContaining({ code: "485", name: "Ingresos anticipados", type: "LIABILITY", isPostable: true }),
      expect.objectContaining({ code: "572", isPostable: true }),
    ]));
  });

  it("maps Spanish PGC mixed subgroups using their official balance presentation", () => {
    const accountsByCode = new Map(getCompanyTemplate("ES")?.accounts.map((account) => [account.code, account]) ?? []);

    expect(accountsByCode.get("407")).toEqual(expect.objectContaining({ type: "ASSET" }));
    expect(accountsByCode.get("438")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("466")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("480")).toEqual(expect.objectContaining({ type: "ASSET" }));
    expect(accountsByCode.get("485")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("499")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("565")).toEqual(expect.objectContaining({ type: "ASSET" }));
    expect(accountsByCode.get("567")).toEqual(expect.objectContaining({ type: "ASSET" }));
    expect(accountsByCode.get("568")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("551")).toEqual(expect.objectContaining({ type: "MIXED" }));
    expect(accountsByCode.get("5523")).toEqual(expect.objectContaining({ type: "MIXED" }));
    expect(accountsByCode.get("5580")).toEqual(expect.objectContaining({ type: "ASSET" }));
    expect(accountsByCode.get("5585")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("5590")).toEqual(expect.objectContaining({ type: "ASSET" }));
    expect(accountsByCode.get("5593")).toEqual(expect.objectContaining({ type: "ASSET" }));
    expect(accountsByCode.get("5595")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("5598")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("585")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
    expect(accountsByCode.get("589")).toEqual(expect.objectContaining({ type: "LIABILITY" }));
  });

  it("builds the generic template with the country's VAT rates and the group-numbered chart", () => {
    const france = getCompanyTemplate("FR");
    expect(france.taxes.map((entry) => [entry.name, entry.rate, entry.isDefault ?? false])).toEqual([
      ["TVA general 20%", "20.000", true],
      ["TVA reducido 10%", "10.000", false],
      ["TVA reducido 5,5%", "5.500", false],
      ["TVA superreducido 2,1%", "2.100", false],
    ]);
    expect(france.taxes.every((entry) => entry.kind === "VAT")).toBe(true);
    expect(france.settings.defaultVatOutputAccountCode).toBe("477");
    expect(france.accounts.find((account) => account.code === "477")?.name).toBe("Impuesto repercutido (IVA/VAT)");
    expect(france.accounts.length).toBe(getCompanyTemplate("ES").accounts.length);
  });

  it("invoices without tax where there is no national VAT", () => {
    expect(genericTemplateTaxes("US")).toEqual([{ name: "Sin impuesto 0%", rate: "0.000", kind: "VAT", operation: "ADD", isDefault: true }]);
    expect(genericTemplateTaxes("ZZ")[0]?.rate).toBe("0.000");
  });
});
