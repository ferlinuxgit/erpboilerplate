import { describe, expect, it } from "vitest";

import { findFiscalPeriodLock } from "@/server/fiscal/locks";

function dbWithReports(reports: Array<{ id: string; code: string; period: string }>) {
  return {
    select: () => ({
      from: () => ({
        where: async () => reports,
      }),
    }),
  };
}

describe("fiscal period locks", () => {
  it("locks dates covered by filed Spanish fiscal reports", async () => {
    const lock = await findFiscalPeriodLock(
      "company-1",
      new Date(Date.UTC(2026, 1, 15)),
      dbWithReports([{ id: "report-1", code: "303", period: "2026-Q1" }]) as never,
    );

    expect(lock).toEqual({ locked: true, reportId: "report-1", code: "303", period: "2026-Q1" });
  });

  it("ignores dates outside filed report ranges", async () => {
    const lock = await findFiscalPeriodLock(
      "company-1",
      new Date(Date.UTC(2026, 4, 1)),
      dbWithReports([{ id: "report-1", code: "303", period: "2026-Q1" }]) as never,
    );

    expect(lock).toEqual({ locked: false });
  });
});
