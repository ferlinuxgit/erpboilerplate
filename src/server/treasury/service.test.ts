import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), recordAudit: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/accounting/auto-post", () => ({ postBankTransaction: vi.fn(), reverseAutomaticEntries: vi.fn() }));
vi.mock("@/server/fiscal/locks", () => ({ assertFiscalPeriodOpen: vi.fn() }));

import { deleteBankAccount } from "@/server/treasury/service";

function txWith(selectResults: unknown[][]) {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "limit", "for"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
    return chain;
  };
  return { select: vi.fn(() => makeChain()), delete: vi.fn(() => ({ where: vi.fn(async () => []) })) };
}

describe("bank account deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks deleting an account with posted movements and suggests archiving it", async () => {
    const tx = txWith([[{ id: "bank-1" }], [{ total: 3 }]]);
    mocks.transaction.mockImplementationOnce(async (callback: (client: unknown) => unknown) => callback(tx));

    await expect(deleteBankAccount("company-1", "tenant-1", "user-1", "bank-1")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Archívala") });
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("deletes an account without movements", async () => {
    const tx = txWith([[{ id: "bank-1" }], [{ total: 0 }]]);
    mocks.transaction.mockImplementationOnce(async (callback: (client: unknown) => unknown) => callback(tx));

    await expect(deleteBankAccount("company-1", "tenant-1", "user-1", "bank-1")).resolves.toBe(true);
    expect(tx.delete).toHaveBeenCalledTimes(2);
  });
});
