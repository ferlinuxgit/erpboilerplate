import { describe, expect, it } from "vitest";

import { dateInputValue } from "@/lib/date-input";

describe("dateInputValue", () => {
  it("uses the company time zone when choosing today's calendar date", () => {
    const instant = new Date("2026-07-31T23:30:00.000Z");

    expect(dateInputValue(instant, "UTC")).toBe("2026-07-31");
    expect(dateInputValue(instant, "Europe/Madrid")).toBe("2026-08-01");
  });

  it("falls back safely when the configured time zone is invalid", () => {
    expect(dateInputValue(new Date("2026-07-31T12:00:00.000Z"), "Invalid/Timezone")).toBe("2026-07-31");
  });
});
