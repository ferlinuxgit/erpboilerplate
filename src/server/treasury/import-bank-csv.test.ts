import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = { selectResults: [] as unknown[][], selectCount: 0 };
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "limit", "innerJoin", "leftJoin"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown) => {
      state.selectCount += 1;
      return Promise.resolve(state.selectResults.shift() ?? []).then(resolve);
    };
    return chain;
  };
  const tx = { select: vi.fn(() => makeChain()) };
  const db = {
    select: vi.fn(() => makeChain()),
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return {
    state,
    tx,
    db,
    recordBankTransaction: vi.fn(async (...args: [companyId: string, tenantId: string, actor: string, payload: { description: string }, client?: unknown]) => ({
      id: `bt-${args[3].description}`,
    })),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/accounting/auto-post", () => ({ reverseAutomaticEntries: vi.fn(), postBankTransaction: vi.fn() }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/server/fiscal/locks", () => ({ resolveOpenPostingDate: vi.fn(), assertFiscalPeriodOpen: vi.fn() }));
vi.mock("@/server/treasury/service", () => ({ recordBankTransaction: mocks.recordBankTransaction }));

import { bankTransactionKey, importBankCsv } from "@/server/treasury/reconciliation";

const actor = { companyId: "company-1", tenantId: "tenant-1", actorUserId: "user-1" };
const csv = [
  "fecha;importe;descripcion",
  "2026-07-18;1250,50;Cobro F-1042",
  "2026-07-19;-80,25;Comisión bancaria",
  "2026-07-19;-80,25;Comisión bancaria",
  "2026-07-20;99,00;Cobro F-1043",
].join("\n");

describe("importBankCsv", () => {
  beforeEach(() => {
    mocks.state.selectResults = [];
    mocks.state.selectCount = 0;
    mocks.recordBankTransaction.mockClear();
  });

  it("checks duplicates with one query for the whole file and skips repeated rows", async () => {
    mocks.state.selectResults.push(
      [{ id: "bank-1", isActive: true }],
      // Already imported earlier: the first row.
      [{ postedAt: new Date("2026-07-18"), amount: "1250.50", description: "Cobro F-1042" }],
    );

    const result = await importBankCsv({ ...actor, bankAccountId: "bank-1", content: csv });

    // Ownership check + a single duplicate lookup (not one per row).
    expect(mocks.state.selectCount).toBe(2);
    expect(result.duplicates).toBe(2);
    expect(mocks.recordBankTransaction.mock.calls.map((call) => call[3])).toEqual([
      { bankAccountId: "bank-1", postedAt: new Date("2026-07-19"), amount: "-80.25", description: "Comisión bancaria" },
      { bankAccountId: "bank-1", postedAt: new Date("2026-07-20"), amount: "99.00", description: "Cobro F-1043" },
    ]);
    // Every row is still recorded (and fiscal-lock checked) inside the same transaction.
    expect(mocks.recordBankTransaction.mock.calls.every((call) => call[4] === mocks.tx)).toBe(true);
  });

  it("normalises amounts in the duplicate key", () => {
    expect(bankTransactionKey(new Date("2026-07-18"), "1250.5", "x")).toBe(bankTransactionKey(new Date("2026-07-18"), 1250.5, "x"));
  });
});
