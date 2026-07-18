import { describe, expect, it } from "vitest";

import { getReportingPeriodRanges } from "@/lib/reporting-period";

describe("reporting periods", () => {
  const now = new Date("2026-07-18T12:00:00.000Z");

  it("builds month and previous-month ranges", () => {
    const ranges = getReportingPeriodRanges("month", now);
    expect(ranges.current.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(ranges.current.end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(ranges.previous.end).toEqual(ranges.current.start);
  });

  it("builds the active calendar quarter", () => {
    const ranges = getReportingPeriodRanges("quarter", now);
    expect(ranges.current.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(ranges.current.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("builds the active calendar year", () => {
    const ranges = getReportingPeriodRanges("year", now);
    expect(ranges.current.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(ranges.current.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
