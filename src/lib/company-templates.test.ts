import { describe, expect, it } from "vitest";

import { getCompanyTemplate } from "@/lib/company-templates";

describe("company templates", () => {
  it("provides general templates for Spain and the United States", () => {
    expect(getCompanyTemplate("ES")?.label).toBe("Espana - General");
    expect(getCompanyTemplate("US")?.label).toBe("United States - General");
  });

  it("keeps United States fiscal posting accounts inside the US template", () => {
    const template = getCompanyTemplate("US");
    expect(template?.settings.defaultVatOutputAccountCode).toBe("2100");
    expect(template?.settings.defaultVatInputAccountCode).toBe("1300");
    expect(template?.accounts.map((account) => account.code)).toEqual(expect.arrayContaining(["1100", "2100", "4000"]));
  });
});
