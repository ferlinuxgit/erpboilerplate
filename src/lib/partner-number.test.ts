import { describe, expect, it } from "vitest";

import { formatPartnerNumber } from "@/lib/partner-number";

describe("formatPartnerNumber", () => {
  it("uses the stable third-party prefix and six-digit padding", () => {
    expect(formatPartnerNumber(1, "CUSTOMER")).toBe("CL000001");
    expect(formatPartnerNumber(42, "SUPPLIER")).toBe("PR000042");
    expect(formatPartnerNumber(3, "BOTH")).toBe("TE000003");
  });

  it("normalizes invalid low and decimal sequence values", () => {
    expect(formatPartnerNumber(0, "CUSTOMER")).toBe("CL000001");
    expect(formatPartnerNumber(12.9, "SUPPLIER")).toBe("PR000012");
  });
});
