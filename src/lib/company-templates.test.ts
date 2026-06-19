import { describe, expect, it } from "vitest";

import { getCompanyTemplate } from "@/lib/company-templates";

describe("company templates", () => {
  it("provides general templates for Spain and the United States", () => {
    expect(getCompanyTemplate("ES")?.label).toBe("Espana - General");
    expect(getCompanyTemplate("US")?.label).toBe("United States - General");
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

  it("keeps United States fiscal posting accounts inside the US template", () => {
    const template = getCompanyTemplate("US");
    expect(template?.settings.defaultVatOutputAccountCode).toBe("2100");
    expect(template?.settings.defaultVatInputAccountCode).toBe("1300");
    expect(template?.accounts.map((account) => account.code)).toEqual(expect.arrayContaining(["1100", "2100", "4000"]));
  });
});
