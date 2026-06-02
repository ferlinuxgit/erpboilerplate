import { describe, expect, it } from "vitest";

import { formatSeriesNumber } from "@/lib/document-series-format";

describe("formatSeriesNumber", () => {
  it("formats sequence with prefix and default padding", () => {
    expect(formatSeriesNumber({ prefix: "FAC-", nextNumber: 7, referenceDate: "2026-05-09" })).toBe("FAC-000007");
  });

  it("supports year tokens and custom number width", () => {
    expect(
      formatSeriesNumber({
        format: "{PREFIX}{YYYY}-{NUMBER:4}",
        prefix: "FAC-",
        nextNumber: 23,
        referenceDate: "2026-05-09",
      }),
    ).toBe("FAC-2026-0023");
  });
});
