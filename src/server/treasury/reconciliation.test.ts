import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reverseAutomaticEntries: vi.fn(async () => 1),
  postBankTransaction: vi.fn(async () => undefined),
  recordAudit: vi.fn(async () => undefined),
  resolveOpenPostingDate: vi.fn(async (_companyId: string, preferred: Date) => preferred),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/accounting/auto-post", () => ({
  reverseAutomaticEntries: mocks.reverseAutomaticEntries,
  postBankTransaction: mocks.postBankTransaction,
}));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/fiscal/locks", () => ({ resolveOpenPostingDate: mocks.resolveOpenPostingDate, assertFiscalPeriodOpen: vi.fn() }));
vi.mock("@/server/treasury/service", () => ({ recordBankTransaction: vi.fn() }));

import { parseBankCsv } from "@/lib/bank-csv";
import { expectedReconcileKind, reconcileBankTransaction, unreconcileBankTransaction } from "@/server/treasury/reconciliation";

/** Cliente simulado: cada select consume la siguiente respuesta; los update devuelven la fila. */
function clientWith(selectResults: unknown[][]) {
  const chain = () => {
    const value: Record<string, unknown> = {};
    for (const method of ["from", "where", "for", "limit", "innerJoin", "leftJoin"]) value[method] = vi.fn(() => value);
    value.then = (resolve: (input: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
    return value;
  };
  const updates: unknown[] = [];
  return {
    updates,
    select: vi.fn(() => chain()),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        updates.push(values);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "bt-1", ...(values as object) }]) })) };
      }),
    })),
  };
}

const actor = { companyId: "company-1", tenantId: "tenant-1", actorUserId: "user-1" };
const movement = { id: "bt-1", bankAccountId: "bank-1", amount: "121.00", description: "Cobro FAC-1", postedAt: new Date("2026-03-02"), status: "PENDING" };

describe("bank CSV parser", () => {
  it("parses semicolon-separated bank rows with decimal comma", () => {
    const rows = parseBankCsv("fecha;importe;descripcion\n2026-07-18;1250,50;Cobro F-1042\n2026-07-19;-80.25;Comisión bancaria");
    expect(rows).toEqual([
      { postedAt: new Date("2026-07-18"), amount: 1250.5, description: "Cobro F-1042" },
      { postedAt: new Date("2026-07-19"), amount: -80.25, description: "Comisión bancaria" },
    ]);
  });

  it("ignores malformed rows without losing valid movements", () => {
    const rows = parseBankCsv("fecha;importe;descripcion\nfecha-invalida;20;Error\n2026-07-18;no-numero;Error\n2026-07-20;45;Abono");
    expect(rows).toEqual([{ postedAt: new Date("2026-07-20"), amount: 45, description: "Abono" }]);
  });

  it("accepts Spanish bank formats: dd/mm/yyyy dates, thousands separators, BOM and ';' inside the concept", () => {
    const rows = parseBankCsv("﻿Fecha;Importe;Concepto\n18/07/2026;1.250,50;Transferencia; ref FAC-1\n19-07-2026;\"-1,080.25\";Recibo\n31/02/2026;10;Fecha imposible\n20/07/2026;0,00;Sin importe");
    expect(rows).toEqual([
      { postedAt: new Date(Date.UTC(2026, 6, 18)), amount: 1250.5, description: "Transferencia; ref FAC-1" },
      { postedAt: new Date(Date.UTC(2026, 6, 19)), amount: -1080.25, description: "Recibo" },
    ]);
  });
});

describe("bank reconciliation keeps a single journal effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("expects customer receipts for deposits and supplier payments for charges", () => {
    expect(expectedReconcileKind("10.00")).toBe("customer");
    expect(expectedReconcileKind("-10.00")).toBe("supplier");
  });

  it("reverses the provisional bank ↔ 555 entry when a movement is matched with a receipt", async () => {
    const client = clientWith([[movement], [{ id: "ip-1" }], []]);

    await reconcileBankTransaction(client as never, { ...actor, transactionId: "bt-1", kind: "customer", matchId: "ip-1" });

    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "bankTransaction",
      sourceId: "bt-1",
      postedAt: movement.postedAt,
      dbClient: client,
    }));
    expect(client.updates[0]).toMatchObject({ reconciliationStatus: "RECONCILED", matchedInvoicePaymentId: "ip-1", matchedSupplierPaymentId: null });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "treasury.reconcile.match" }), client);
  });

  it("uses today's date for the reversal when the movement's period is locked", async () => {
    const today = new Date("2026-05-10");
    mocks.resolveOpenPostingDate.mockResolvedValueOnce(today);
    const client = clientWith([[movement], [{ id: "ip-1" }], []]);

    await reconcileBankTransaction(client as never, { ...actor, transactionId: "bt-1", kind: "customer", matchId: "ip-1", now: today });

    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({ postedAt: today }));
  });

  it("rejects matches with the wrong sign, a different amount or an already used receipt", async () => {
    await expect(reconcileBankTransaction(clientWith([[movement]]) as never, { ...actor, transactionId: "bt-1", kind: "supplier", matchId: "x" })).rejects.toMatchObject({ status: 422 });
    await expect(reconcileBankTransaction(clientWith([[movement], []]) as never, { ...actor, transactionId: "bt-1", kind: "customer", matchId: "x" })).rejects.toMatchObject({ status: 422 });
    await expect(reconcileBankTransaction(clientWith([[movement], [{ id: "ip-1" }], [{ id: "bt-2" }]]) as never, { ...actor, transactionId: "bt-1", kind: "customer", matchId: "ip-1" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.reverseAutomaticEntries).not.toHaveBeenCalled();
  });

  it("refuses to reconcile twice", async () => {
    await expect(reconcileBankTransaction(clientWith([[{ ...movement, status: "RECONCILED" }]]) as never, { ...actor, transactionId: "bt-1", kind: "customer", matchId: "ip-1" })).rejects.toMatchObject({ status: 409 });
  });

  it("re-posts the movement against 555 when it is unreconciled", async () => {
    const client = clientWith([[{ ...movement, status: "RECONCILED" }]]);

    await unreconcileBankTransaction(client as never, { ...actor, transactionId: "bt-1" });

    expect(mocks.postBankTransaction).toHaveBeenCalledWith(expect.objectContaining({
      bankTransactionId: "bt-1",
      bankAccountId: "bank-1",
      amount: 121,
      postedAt: movement.postedAt,
      dbClient: client,
    }));
    expect(client.updates[0]).toMatchObject({ reconciliationStatus: "PENDING", matchedInvoicePaymentId: null, matchedSupplierPaymentId: null });
  });
});
