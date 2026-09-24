import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: { select: () => undefined } }));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/accounting/service", () => ({ ensureDefaultJournal: vi.fn() }));
vi.mock("@/server/accounting/numbers", () => ({ reserveJournalEntryNumber: vi.fn() }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

import { resolveAccounts, resolveBankLedgerAccountId } from "@/server/accounting/auto-post";

const accountRows = [
  { id: "customer-account", code: "4300" },
  { id: "supplier-account", code: "4100" },
  { id: "sales-account", code: "700" },
  { id: "purchase-account", code: "600" },
  { id: "bank-account", code: "572" },
  { id: "vat-output-account", code: "477" },
  { id: "vat-input-account", code: "472" },
  { id: "withholding-payable-account", code: "4751" },
  { id: "withholding-receivable-account", code: "473" },
  { id: "suspense-account", code: "555" },
];

/** Transaction-like client: each `select` consumes the next queued result; `where` args are recorded. */
function transactionClient(results: unknown[][]) {
  const whereCalls: unknown[] = [];
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "limit", "innerJoin", "leftJoin"]) chain[method] = vi.fn(() => chain);
    chain.where = vi.fn((condition: unknown) => {
      whereCalls.push(condition);
      return chain;
    });
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results.shift() ?? []).then(resolve);
    return chain;
  });
  return { select, whereCalls };
}

describe("resolveAccounts", () => {
  it("loads settings and every role account in one accounts query, then serves the transaction from memory", async () => {
    const tx = transactionClient([[], [{ countryCode: "ES" }], accountRows]);

    const first = await resolveAccounts("company-1", ["customer", "sales", "vatOutput"], tx as never);
    expect(first.ids).toEqual({ customer: "customer-account", sales: "sales-account", vatOutput: "vat-output-account" });
    // settings + company (in parallel) + a single account_chart query.
    expect(tx.select).toHaveBeenCalledTimes(3);

    // Other roles in the same transaction (e.g. the next CSV row): no extra queries.
    const second = await resolveAccounts("company-1", ["bank", "suspense"], tx as never);
    const third = await resolveAccounts("company-1", ["purchase", "supplier", "vatInput", "vatOutput", "withholdingPayable"], tx as never);
    expect(second.ids).toEqual({ bank: "bank-account", suspense: "suspense-account" });
    expect(third.ids.withholdingPayable).toBe("withholding-payable-account");
    expect(tx.select).toHaveBeenCalledTimes(3);
  });

  it("keeps memos per transaction and per company", async () => {
    const txA = transactionClient([[], [{ countryCode: "ES" }], accountRows, [], [{ countryCode: "ES" }], accountRows]);
    const txB = transactionClient([[], [{ countryCode: "ES" }], accountRows]);

    await resolveAccounts("company-1", ["bank"], txA as never);
    await resolveAccounts("company-2", ["bank"], txA as never);
    await resolveAccounts("company-1", ["bank"], txB as never);
    expect(txA.select).toHaveBeenCalledTimes(6);
    expect(txB.select).toHaveBeenCalledTimes(3);
  });

  it("re-reads once when a memoized lookup misses an account, then fails with ACCOUNT_MISSING", async () => {
    const withoutSuspense = accountRows.filter((row) => row.code !== "555");
    const tx = transactionClient([[], [{ countryCode: "ES" }], withoutSuspense, [], [{ countryCode: "ES" }], withoutSuspense]);

    await resolveAccounts("company-1", ["bank"], tx as never);
    await expect(resolveAccounts("company-1", ["bank", "suspense"], tx as never)).rejects.toMatchObject({ code: "ACCOUNT_MISSING" });
    expect(tx.select).toHaveBeenCalledTimes(6);
  });

  it("picks up an account created later in the same transaction", async () => {
    const withoutSuspense = accountRows.filter((row) => row.code !== "555");
    const tx = transactionClient([[], [{ countryCode: "ES" }], withoutSuspense, [], [{ countryCode: "ES" }], accountRows]);

    await resolveAccounts("company-1", ["bank"], tx as never);
    const { ids } = await resolveAccounts("company-1", ["suspense"], tx as never);
    expect(ids.suspense).toBe("suspense-account");
  });

  it("uses the company's configured account codes", async () => {
    const tx = transactionClient([[{ defaultBankAccountCode: "5720001" }], [{ countryCode: "ES" }], [{ id: "custom-bank", code: "5720001" }]]);
    const { ids } = await resolveAccounts("company-1", ["bank"], tx as never);
    expect(ids.bank).toBe("custom-bank");
  });
});

describe("resolveBankLedgerAccountId", () => {
  it("memoizes the ledger account of a bank account within a transaction", async () => {
    const tx = transactionClient([[{ accountId: "ledger-5720001" }]]);
    const lookups = await Promise.all([
      resolveBankLedgerAccountId(tx as never, "company-1", { bankAccountId: "bank-1" }),
      resolveBankLedgerAccountId(tx as never, "company-1", { bankAccountId: "bank-1" }),
    ]);
    expect(lookups).toEqual(["ledger-5720001", "ledger-5720001"]);
    expect(tx.select).toHaveBeenCalledTimes(1);
  });
});
