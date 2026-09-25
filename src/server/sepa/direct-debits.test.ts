import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  reverseAutomaticEntries: vi.fn(async () => 1),
  postBankTransactionAssignment: vi.fn(async () => ({ id: "je-fee" })),
  recordAudit: vi.fn(async () => undefined),
  resolveOpenPostingDate: vi.fn(async (_companyId: string, preferred: Date) => preferred),
  removeInvoicePayment: vi.fn(async () => true),
  createCustomerPaymentForBank: vi.fn(async (_client: unknown, _actor: unknown, input: { invoiceId: string }) => ({ paymentId: `pay-${input.invoiceId}`, applicationId: `ip-${input.invoiceId}`, number: "REC", invoiceNumber: input.invoiceId })),
}));

vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/server/accounting/auto-post", () => ({ reverseAutomaticEntries: mocks.reverseAutomaticEntries, postBankTransactionAssignment: mocks.postBankTransactionAssignment }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/fiscal/locks", () => ({ resolveOpenPostingDate: mocks.resolveOpenPostingDate }));
vi.mock("@/server/invoices/payments", () => ({ removeInvoicePayment: mocks.removeInvoicePayment }));
vi.mock("@/server/invoices/service", () => ({ getInvoiceBalance: vi.fn() }));
vi.mock("@/server/invoices/sql", () => ({}));
vi.mock("@/server/treasury/bank-payments", () => ({ createCustomerPaymentForBank: mocks.createCustomerPaymentForBank }));

import { markDirectDebitCollected, returnDirectDebitItem, undoDirectDebitCollection } from "@/server/sepa/direct-debits";

/** Cliente simulado: cada select consume la siguiente respuesta; registra inserts y updates. */
function clientWith(selectResults: unknown[][]) {
  const chain = () => {
    const value: Record<string, unknown> = {};
    for (const method of ["from", "where", "for", "limit", "innerJoin", "leftJoin", "orderBy"]) value[method] = vi.fn(() => value);
    value.then = (resolve: (input: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
    return value;
  };
  const inserts: unknown[] = [];
  const updates: Record<string, unknown>[] = [];
  return {
    inserts,
    updates,
    select: vi.fn(() => chain()),
    insert: vi.fn(() => ({ values: vi.fn(async (values: unknown) => { inserts.push(values); }) })),
    update: vi.fn(() => ({ set: vi.fn((values: Record<string, unknown>) => { updates.push(values); return { where: vi.fn(async () => undefined) }; }) })),
  };
}

const actor = { tenantId: "t", companyId: "c", actorUserId: "u", activeFiscalYearId: "fy" };
const collectionDate = new Date("2026-09-29T00:00:00.000Z");
const collectedItem = {
  id: "item-1",
  remittanceId: "dd-1",
  invoiceId: "inv-1",
  mandateId: "m-1",
  amount: "121.00",
  endToEndId: "ADE1-1",
  sequenceType: "FRST",
  status: "COLLECTED",
  paymentId: "pay-1",
  returnBankTransactionId: null,
  remittanceNumber: "ADE1",
  remittanceStatus: "COLLECTED",
  bankAccountId: "bank-1",
  collectionDate,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("returned direct debit (devolución)", () => {
  it("undoes the payment on the return date, makes the mandate FRST again and reconciles the charge with its fee", async () => {
    const client = clientWith([
      [collectedItem],
      [{ collectionCount: 1, firstCollectionAt: collectionDate, lastCollectionAt: collectionDate, status: "ACTIVE" }],
      [{ id: "bt-9", bankAccountId: "bank-1", amount: "-124.50", description: "DEVOLUCION RECIBO", postedAt: new Date("2026-10-05T00:00:00.000Z"), status: "PENDING" }],
      [{ id: "acc-626", code: "6260000" }],
    ]);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(client));
    const returnedAt = new Date("2026-10-05T00:00:00.000Z");
    const result = await returnDirectDebitItem(actor, "item-1", { returnedAt, reason: "Fondos insuficientes", bankTransactionId: "bt-9" });

    expect(mocks.removeInvoicePayment).toHaveBeenCalledWith(actor, "pay-1", expect.objectContaining({ postedAt: returnedAt, origin: "sepa.return" }), client);
    expect(client.updates).toContainEqual(expect.objectContaining({ collectionCount: 0, firstCollectionAt: null }));
    expect(client.updates).toContainEqual(expect.objectContaining({ status: "RETURNED", paymentId: null, returnReason: "Fondos insuficientes" }));
    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "bankTransaction", sourceId: "bt-9" }));
    expect(mocks.postBankTransactionAssignment).toHaveBeenCalledWith(expect.objectContaining({ bankTransactionId: "bt-9", movementAmount: -124.5, allocations: [{ accountId: "acc-626", amount: 3.5 }] }));
    expect(client.inserts).toEqual([expect.objectContaining({ bankTransactionId: "bt-9", kind: "ACCOUNT", accountId: "acc-626", amount: "3.50" })]);
    expect(client.updates).toContainEqual(expect.objectContaining({ reconciliationStatus: "RECONCILED", resolution: "MIXED" }));
    expect(client.updates).toContainEqual({ returnBankTransactionId: "bt-9", returnFeeAmount: "3.50" });
    expect(result.link).toEqual({ bankTransactionId: "bt-9", fee: 3.5, feeAccountCode: "6260000" });
  });

  it("rejects a charge smaller than the receipt or from another bank account", async () => {
    const smaller = clientWith([
      [collectedItem],
      [{ collectionCount: 1, firstCollectionAt: collectionDate, lastCollectionAt: collectionDate, status: "ACTIVE" }],
      [{ id: "bt-9", bankAccountId: "bank-1", amount: "-100.00", description: "DEVOLUCION", postedAt: collectionDate, status: "PENDING" }],
    ]);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(smaller));
    await expect(returnDirectDebitItem(actor, "item-1", { returnedAt: collectionDate, bankTransactionId: "bt-9" })).rejects.toMatchObject({ status: 422, code: "RETURN_AMOUNT" });

    const otherBank = clientWith([
      [collectedItem],
      [{ collectionCount: 1, firstCollectionAt: collectionDate, lastCollectionAt: collectionDate, status: "ACTIVE" }],
      [{ id: "bt-9", bankAccountId: "bank-2", amount: "-121.00", description: "DEVOLUCION", postedAt: collectionDate, status: "PENDING" }],
    ]);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(otherBank));
    await expect(returnDirectDebitItem(actor, "item-1", { returnedAt: collectionDate, bankTransactionId: "bt-9" })).rejects.toMatchObject({ code: "RETURN_BANK" });
  });

  it("only returns collected receipts", async () => {
    const client = clientWith([[{ ...collectedItem, status: "PENDING", paymentId: null }]]);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(client));
    await expect(returnDirectDebitItem(actor, "item-1", { returnedAt: collectionDate })).rejects.toMatchObject({ status: 409 });
    expect(mocks.removeInvoicePayment).not.toHaveBeenCalled();
  });
});

describe("collecting a direct debit remittance", () => {
  it("creates one customer payment per receipt through the shared service and tracks the mandate sequence", async () => {
    const client = clientWith([
      [{ id: "dd-1", number: "ADE1", status: "GENERATED", bankAccountId: "bank-1", collectionDate }],
      [
        { id: "item-1", invoiceId: "inv-1", mandateId: "m-1", amount: "121.00", endToEndId: "ADE1-1", sequenceType: "FRST" },
        { id: "item-2", invoiceId: "inv-2", mandateId: "m-2", amount: "60.50", endToEndId: "ADE1-2", sequenceType: "OOFF" },
      ],
      [{ collectionCount: 0, firstCollectionAt: null, lastCollectionAt: null, status: "ACTIVE" }],
      [{ collectionCount: 0, firstCollectionAt: null, lastCollectionAt: null, status: "ACTIVE" }],
    ]);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(client));
    const now = new Date("2026-09-30T10:00:00.000Z");
    await expect(markDirectDebitCollected(actor, "dd-1", now)).resolves.toEqual({ id: "dd-1", payments: 2 });
    expect(mocks.createCustomerPaymentForBank).toHaveBeenCalledWith(client, actor, expect.objectContaining({ invoiceId: "inv-1", amount: 121, postedAt: collectionDate, bankAccountId: "bank-1", origin: "sepa", reference: "Remesa ADE1 · ADE1-1" }));
    expect(client.updates).toContainEqual({ status: "COLLECTED", paymentId: "pay-inv-1" });
    expect(client.updates).toContainEqual(expect.objectContaining({ collectionCount: 1, firstCollectionAt: collectionDate, lastCollectionAt: collectionDate, status: "ACTIVE" }));
    // Un mandato de un solo uso queda cerrado tras cobrarse.
    expect(client.updates).toContainEqual(expect.objectContaining({ collectionCount: 1, status: "REVOKED", revokedAt: now }));
    expect(client.updates).toContainEqual({ status: "COLLECTED", collectedAt: now });
  });

  it("does not undo a collection with returned receipts", async () => {
    const client = clientWith([
      [{ id: "dd-1", number: "ADE1", status: "COLLECTED", bankAccountId: "bank-1", collectionDate }],
      [{ id: "item-1", status: "RETURNED", paymentId: null, mandateId: "m-1", sequenceType: "FRST" }],
    ]);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(client));
    await expect(undoDirectDebitCollection(actor, "dd-1")).rejects.toMatchObject({ status: 409, code: "REMITTANCE_HAS_RETURNS" });
    expect(mocks.removeInvoicePayment).not.toHaveBeenCalled();
  });
});
