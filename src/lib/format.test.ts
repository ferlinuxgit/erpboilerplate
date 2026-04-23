import { describe, expect, it } from "vitest";

import { formatDate, formatMoney } from "@/lib/format";

describe("format helpers", () => {
  it("formatea moneda en euros", () => {
    expect(formatMoney(10.5, "EUR", "es-ES")).toContain("10");
  });

  it("formatea fecha", () => {
    expect(formatDate(new Date("2026-01-01T00:00:00.000Z"), "es-ES")).toContain("2026");
  });
});
