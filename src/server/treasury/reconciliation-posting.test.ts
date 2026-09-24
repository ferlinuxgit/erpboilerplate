import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reverseAutomaticEntries: vi.fn(async () => 1),
  postBankTransaction: vi.fn(async () => undefined),
  resolveOpenPostingDate: vi.fn(async (_companyId: string, preferred: Date) => preferred),
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/accounting/auto-post", () => ({ reverseAutomaticEntries: mocks.reverseAutomaticEntries, postBankTransaction: mocks.postBankTransaction }));
vi.mock("@/server/fiscal/locks", () => ({ resolveOpenPostingDate: mocks.resolveOpenPostingDate }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/treasury/service", () => ({ recordBankTransaction: vi.fn() }));

import { expectedReconcileKind, reconcileBankTransaction, unreconcileBankTransaction } from "@/server/treasury/reconciliation";

function clientWith(selectResults: unknown[][]) {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "limit", "innerJoin", "leftJoin", "for"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
    return chain;
  };
  const updates: unknown[] = [];
  return {
    updates,
    select: vi.fn(() => makeChain()),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        updates.push(values);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "bt-1", ...(values as object) }]) })) };
      }),
    })),
  };
}

const actor = { companyId: "company-1", tenantId: "tenant-1", actorUserId: "user-1" };
const movement = { id: "bt-1", bankAccountId: "bank-1", amount: "121.00", description: "Transferencia cliente", postedAt: new Date("2026-05-10"), status: "PENDING" };

describe("bank reconciliation posting model", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives the counterpart kind from the movement sign", () => {
    expect(expectedReconcileKind("10")).toBe("customer");
    expect(expectedReconcileKind("-10")).toBe("supplier");
  });

  it("reverses the provisional bank/555 entry when the movement is matched with a customer payment (no double posting)", async () => {
    const client = clientWith([[movement], [{ id: "ip-1" }], []]);
    await reconcileBankTransaction(client as never, { ...actor, transactionId: "bt-1", kind: "customer", matchId: "ip-1" });

    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "bankTransaction", sourceId: "bt-1", postedAt: movement.postedAt }));
    expect(client.updates[0]).toMatchObject({ reconciliationStatus: "RECONCILED", matchedInvoicePaymentId: "ip-1", matchedSupplierPaymentId: null });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "treasury.reconcile.match" }), client);
  });

  it("rejects payments already matched with another movement", async () => {
    const client = clientWith([[movement], [{ id: "ip-1" }], [{ id: "bt-other" }]]);
    await expect(reconcileBankTransaction(client as never, { ...actor, transactionId: "bt-1", kind: "customer", matchId: "ip-1" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.reverseAutomaticEntries).not.toHaveBeenCalled();
  });

  it("rejects a supplier payment for an incoming movement", async () => {
    const client = clientWith([[movement]]);
    await expect(reconcileBankTransaction(client as never, { ...actor, transactionId: "bt-1", kind: "supplier", matchId: "sp-1" })).rejects.toMatchObject({ status: 422 });
  });

  it("re-posts the movement against 555 when it is unreconciled", async () => {
    const client = clientWith([[{ ...movement, status: "RECONCILED" }]]);
    await unreconcileBankTransaction(client as never, { ...actor, transactionId: "bt-1" });

    expect(mocks.postBankTransaction).toHaveBeenCalledWith(expect.objectContaining({ bankTransactionId: "bt-1", bankAccountId: "bank-1", amount: 121 }));
    expect(client.updates[0]).toMatchObject({ reconciliationStatus: "PENDING", matchedInvoicePaymentId: null });
  });
});
