import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const chain = () => {
    const value: Record<string, unknown> = {};
    for (const method of ["from", "where", "for", "limit", "innerJoin", "leftJoin", "orderBy"]) value[method] = () => value;
    value.then = (resolve: (input: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
    return value;
  };
  return { selectResults, db: { select: () => chain() } };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/accounting/auto-post", () => ({}));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/server/fiscal/locks", () => ({ resolveOpenPostingDate: vi.fn() }));
vi.mock("@/server/treasury/bank-payments", () => ({}));
vi.mock("@/server/treasury/reconciliation", () => ({ unreconcileBankTransaction: vi.fn() }));
vi.mock("@/server/sepa/direct-debits", () => ({ returnedItemForMovement: vi.fn() }));
vi.mock("@/server/treasury/rules", () => ({ createReconciliationRule: vi.fn() }));
vi.mock("@/server/invoices/sql", () => ({}));

import { listManualMatchCandidates } from "@/server/treasury/workbench";

beforeEach(() => {
  mocks.selectResults.length = 0;
});

describe("legacy manual reconcile candidates (GET /api/treasury/reconcile)", () => {
  it("excludes payments already matched 1:1 or allocated to another movement in the workbench", async () => {
    mocks.selectResults.push(
      [{ id: "bt-1", amount: "121.00", status: "PENDING" }],
      // usedPaymentIds: columnas del movimiento conciliado y partidas de la mesa.
      [{ invoicePaymentId: "ip-matched", supplierPaymentId: null }],
      [{ invoicePaymentId: "ip-allocated", supplierPaymentId: null }],
      [
        { id: "ip-matched", number: "REC-1", counterparty: "A", amount: "121.00", postedAt: new Date() },
        { id: "ip-allocated", number: "REC-2", counterparty: "B", amount: "121.00", postedAt: new Date() },
        { id: "ip-free", number: "REC-3", counterparty: "C", amount: "121.00", postedAt: new Date() },
      ],
    );
    const result = await listManualMatchCandidates("c", "bt-1");
    expect(result?.kind).toBe("customer");
    expect(result?.candidates.map((candidate) => candidate.id)).toEqual(["ip-free"]);
  });

  it("returns supplier candidates for charges and nothing for reconciled or unknown movements", async () => {
    mocks.selectResults.push([{ id: "bt-2", amount: "-50.00", status: "RECONCILED" }]);
    await expect(listManualMatchCandidates("c", "bt-2")).resolves.toEqual({ kind: "supplier", candidates: [] });
    mocks.selectResults.push([]);
    await expect(listManualMatchCandidates("c", "missing")).resolves.toBeNull();
  });
});
