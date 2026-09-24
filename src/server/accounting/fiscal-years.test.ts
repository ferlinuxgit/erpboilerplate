import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  /** Transacción Drizzle simulada: cada `select` consume la siguiente respuesta de la cola. */
  const createTxMock = () => {
    const selectResults: unknown[][] = [];
    const updates: unknown[] = [];
    const makeChain = () => {
      const chain: Record<string, unknown> = {};
      for (const method of ["from", "where", "limit", "innerJoin", "orderBy", "groupBy", "for"]) {
        chain[method] = vi.fn(() => chain);
      }
      chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(selectResults.shift() ?? []).then(resolve, reject);
      return chain;
    };
    return {
      selectResults,
      updates,
      select: vi.fn(() => makeChain()),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return { where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "fy-2026", isClosed: false }]) })) };
        }),
      })),
    };
  };
  const state = { tx: createTxMock() };
  return {
    createTxMock,
    state,
    db: { transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(state.tx)) },
    recordAudit: vi.fn(async () => undefined),
    reverseAutomaticEntries: vi.fn<(input: Record<string, unknown>) => Promise<number>>(async () => 1),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/accounting/auto-post", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/accounting/auto-post")>()),
  reverseAutomaticEntries: mocks.reverseAutomaticEntries,
}));

import {
  buildClosingLines,
  buildOpeningLines,
  buildRegularizationLines,
  describeFiscalYearLifecycle,
  FISCAL_YEAR_SOURCE,
  isProfitAndLossAccount,
  nextFiscalYearRange,
  reopenFiscalYear,
} from "@/server/accounting/fiscal-years";
import { normalizePostingLines } from "@/server/accounting/auto-post";

const year2026 = { id: "fy-2026", code: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)), isClosed: false };

describe("fiscal year lifecycle rules", () => {
  it("classifies PGC groups 6 and 7 as profit and loss accounts", () => {
    expect(isProfitAndLossAccount({ code: "600", type: "EXPENSE" }, "ES")).toBe(true);
    expect(isProfitAndLossAccount({ code: "7000", type: "REVENUE" }, "ES")).toBe(true);
    expect(isProfitAndLossAccount({ code: "572", type: "ASSET" }, "ES")).toBe(false);
    expect(isProfitAndLossAccount({ code: "129", type: "EQUITY" }, "ES")).toBe(false);
    expect(isProfitAndLossAccount({ code: "4000", type: "REVENUE" }, "US")).toBe(true);
  });

  it("regularizes expenses and income into 129 (profit on the credit side)", () => {
    const lines = buildRegularizationLines([
      { accountId: "600", code: "600", type: "EXPENSE", balanceCents: 40_000 },
      { accountId: "700", code: "700", type: "REVENUE", balanceCents: -100_000 },
    ], "129");
    expect(normalizePostingLines(lines)).toEqual([
      { accountId: "600", debit: "0.00", credit: "400.00" },
      { accountId: "700", debit: "1000.00", credit: "0.00" },
      { accountId: "129", debit: "0.00", credit: "600.00" },
    ]);
  });

  it("regularizes a loss to the debit of 129 and returns nothing when there are no balances", () => {
    const lines = buildRegularizationLines([{ accountId: "600", code: "600", type: "EXPENSE", balanceCents: 5_000 }], "129");
    expect(lines.at(-1)).toEqual({ accountId: "129", debit: "50.00", credit: "0.00" });
    expect(buildRegularizationLines([{ accountId: "600", code: "600", type: "EXPENSE", balanceCents: 0 }], "129")).toEqual([]);
  });

  it("closes every balance sheet account and opens the next year with the exact inverse entry", () => {
    const closing = buildClosingLines([
      { accountId: "572", code: "572", type: "ASSET", balanceCents: 121_000 },
      { accountId: "477", code: "477", type: "LIABILITY", balanceCents: -21_000 },
      { accountId: "129", code: "129", type: "EQUITY", balanceCents: -100_000 },
      { accountId: "430", code: "430", type: "ASSET", balanceCents: 0 },
    ]);
    expect(normalizePostingLines(closing)).toEqual([
      { accountId: "572", debit: "0.00", credit: "1210.00" },
      { accountId: "477", debit: "210.00", credit: "0.00" },
      { accountId: "129", debit: "1000.00", credit: "0.00" },
    ]);
    const opening = normalizePostingLines(buildOpeningLines(normalizePostingLines(closing)));
    expect(opening).toEqual([
      { accountId: "572", debit: "1210.00", credit: "0.00" },
      { accountId: "477", debit: "0.00", credit: "210.00" },
      { accountId: "129", debit: "0.00", credit: "1000.00" },
    ]);
  });

  it("refuses to close an unbalanced ledger", () => {
    expect(() => buildClosingLines([{ accountId: "572", code: "572", type: "ASSET", balanceCents: 100 }])).toThrow("no cuadra");
  });

  it("computes the next calendar and non-calendar fiscal years", () => {
    expect(nextFiscalYearRange(year2026)).toEqual({
      code: "2027",
      startsAt: new Date(Date.UTC(2027, 0, 1)),
      endsAt: new Date(Date.UTC(2027, 11, 31)),
    });
    expect(nextFiscalYearRange({ code: "2025-26", startsAt: new Date(Date.UTC(2025, 6, 1)), endsAt: new Date(Date.UTC(2026, 5, 30)) })).toEqual({
      code: "2026-27",
      startsAt: new Date(Date.UTC(2026, 6, 1)),
      endsAt: new Date(Date.UTC(2027, 5, 30)),
    });
  });

  it("alerts when the active year ends within 30 days or has already ended", () => {
    expect(describeFiscalYearLifecycle(year2026, [year2026], new Date(Date.UTC(2026, 8, 24))).alert).toBe("none");
    const soon = describeFiscalYearLifecycle(year2026, [year2026], new Date(Date.UTC(2026, 11, 5)));
    expect(soon).toMatchObject({ alert: "ending-soon", daysUntilEnd: 26, nextYear: null, nextYearCode: "2027" });
    const next = { id: "fy-2027", code: "2027", startsAt: new Date(Date.UTC(2027, 0, 1)), endsAt: new Date(Date.UTC(2027, 11, 31)), isClosed: false };
    expect(describeFiscalYearLifecycle(year2026, [year2026, next], new Date(Date.UTC(2027, 0, 3)))).toMatchObject({
      alert: "ended",
      nextYear: { id: "fy-2027", code: "2027" },
    });
  });
});

describe("reopenFiscalYear", () => {
  const actor = { companyId: "company-1", tenantId: "tenant-1", actorUserId: "owner-1" };
  const closed2026 = { ...year2026, isClosed: true };
  const year2027 = { id: "fy-2027", code: "2027", startsAt: new Date(Date.UTC(2027, 0, 1)), endsAt: new Date(Date.UTC(2027, 11, 31)), isClosed: false };

  beforeEach(() => {
    mocks.state.tx = mocks.createTxMock();
    mocks.recordAudit.mockClear();
    mocks.reverseAutomaticEntries.mockClear();
  });

  it("rejects a year that is not closed with 409", async () => {
    mocks.state.tx.selectResults.push([year2026]);
    await expect(reopenFiscalYear({ ...actor, fiscalYearId: "fy-2026", reason: "Error en factura" })).rejects.toMatchObject({
      status: 409,
      code: "FISCAL_YEAR_NOT_CLOSED",
    });
    expect(mocks.reverseAutomaticEntries).not.toHaveBeenCalled();
  });

  it("rejects when a later fiscal year is already closed", async () => {
    mocks.state.tx.selectResults.push([closed2026], [closed2026, { ...year2027, isClosed: true }]);
    await expect(reopenFiscalYear({ ...actor, fiscalYearId: "fy-2026", reason: "Error en factura" })).rejects.toMatchObject({
      status: 409,
      code: "LATER_YEAR_CLOSED",
      message: "Antes de reabrir 2026 tienes que reabrir el ejercicio 2027.",
    });
    expect(mocks.reverseAutomaticEntries).not.toHaveBeenCalled();
    expect(mocks.state.tx.updates).toEqual([]);
  });

  it("reverses opening, closing and regularization entries, reopens the year and audits with the tx", async () => {
    const tx = mocks.state.tx;
    tx.selectResults.push([closed2026], [closed2026, year2027]);
    const result = await reopenFiscalYear({ ...actor, fiscalYearId: "fy-2026", reason: "Factura de diciembre olvidada" });

    const calls = mocks.reverseAutomaticEntries.mock.calls.map(([input]) => input);
    expect(calls.map((call) => [call.sourceType, call.sourceId, (call.postedAt as Date).toISOString()])).toEqual([
      [FISCAL_YEAR_SOURCE.opening, "fy-2027", "2027-01-01T00:00:00.000Z"],
      [FISCAL_YEAR_SOURCE.closing, "fy-2026", "2026-12-31T23:59:59.000Z"],
      [FISCAL_YEAR_SOURCE.regularization, "fy-2026", "2026-12-31T23:59:58.000Z"],
    ]);
    for (const call of calls) {
      expect(call).toMatchObject({ ...actor, dbClient: tx });
      expect(call.reason).toContain("Factura de diciembre olvidada");
    }

    expect(tx.updates).toEqual([{ isClosed: false, closedAt: null }]);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "accounting.fiscalYear.reopen",
        entityName: "fiscalYear",
        entityId: "fy-2026",
        payload: expect.objectContaining({
          code: "2026",
          reason: "Factura de diciembre olvidada",
          reversed: { opening: 1, closing: 1, regularization: 1 },
        }),
      }),
      tx,
    );
    expect(result.reversed).toEqual({ opening: 1, closing: 1, regularization: 1 });
  });

  it("skips the opening reversal when the next year does not exist", async () => {
    mocks.state.tx.selectResults.push([closed2026], [closed2026]);
    const result = await reopenFiscalYear({ ...actor, fiscalYearId: "fy-2026", reason: "Ajuste de amortización" });
    expect(mocks.reverseAutomaticEntries.mock.calls.map(([input]) => input.sourceType)).toEqual([
      FISCAL_YEAR_SOURCE.closing,
      FISCAL_YEAR_SOURCE.regularization,
    ]);
    expect(result.reversed.opening).toBe(0);
  });
});
