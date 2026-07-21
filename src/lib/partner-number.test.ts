import { describe, expect, it } from "vitest";

import { formatPartnerNumber } from "@/lib/partner-number";

describe("formatPartnerNumber", () => {
  it("uses the stable third-party prefix and six-digit padding", () => {
    expect(formatPartnerNumber(1)).toBe("TER-000001");
    expect(formatPartnerNumber(42)).toBe("TER-000042");
  });

  it("normalizes invalid low and decimal sequence values", () => {
    expect(formatPartnerNumber(0)).toBe("TER-000001");
    expect(formatPartnerNumber(12.9)).toBe("TER-000012");
  });
});
