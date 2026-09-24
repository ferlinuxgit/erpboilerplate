import { describe, expect, it } from "vitest";

import { assertFiscalPeriodOpen, findFiscalPeriodLock, fiscalYearEndExclusive, FiscalPeriodLockedError } from "@/server/fiscal/locks";

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

  it("treats the fiscal year end date as a full day (31/12 afternoon still belongs to the year)", () => {
    expect(fiscalYearEndExclusive(new Date(Date.UTC(2026, 11, 31)))).toEqual(new Date(Date.UTC(2027, 0, 1)));
  });

  it("raises a 409 domain error with a Spanish message for filed periods", async () => {
    let selectCall = 0;
    const client = {
      select: () => {
        selectCall += 1;
        const isYearQuery = selectCall % 2 === 1;
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.where = () => (isYearQuery ? chain : Promise.resolve([{ id: "report-1", code: "303", period: "2026-Q1" }]));
        chain.limit = async () => [{ code: "2026", isClosed: false }];
        return chain;
      },
    };
    await expect(assertFiscalPeriodOpen("company-1", new Date(Date.UTC(2026, 1, 15)), client as never)).rejects.toBeInstanceOf(FiscalPeriodLockedError);
    await expect(assertFiscalPeriodOpen("company-1", new Date(Date.UTC(2026, 1, 15)), client as never)).rejects.toMatchObject({ status: 409 });
  });
});
