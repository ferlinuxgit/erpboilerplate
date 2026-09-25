import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reverseAutomaticEntries: vi.fn(async () => 1),
  postBankTransaction: vi.fn(async () => undefined),
  postBankTransactionAssignment: vi.fn(async () => ({ id: "je-assign", number: "000010" })),
  loadPostingSettings: vi.fn(async () => ({ countryCode: "ES", prorrataPct: 100, codes: { suspense: "555", bank: "572" } })),
  resolveBankLedgerAccountId: vi.fn(async () => "acc-572001"),
  resolveOpenPostingDate: vi.fn(async (_companyId: string, preferred: Date) => preferred),
  recordAudit: vi.fn(async () => undefined),
  createCustomerPaymentForBank: vi.fn(async (_client: unknown, _actor: unknown, input: { invoiceId: string }) => ({ paymentId: `pay-${input.invoiceId}`, applicationId: `ip-${input.invoiceId}`, number: `REC-${input.invoiceId}`, invoiceNumber: input.invoiceId })),
  createSupplierPaymentForBank: vi.fn(),
  removeTreasuryCustomerPayment: vi.fn(async () => true),
  removeTreasurySupplierPayment: vi.fn(async () => true),
  unreconcileBankTransaction: vi.fn(async () => ({ id: "bt-1" })),
  createReconciliationRule: vi.fn(async () => ({ id: "rule-new", name: "comision" })),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/accounting/auto-post", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/accounting/auto-post")>();
  return {
    buildBankAssignmentLines: original.buildBankAssignmentLines,
    reverseAutomaticEntries: mocks.reverseAutomaticEntries,
    postBankTransaction: mocks.postBankTransaction,
    postBankTransactionAssignment: mocks.postBankTransactionAssignment,
    loadPostingSettings: mocks.loadPostingSettings,
    resolveBankLedgerAccountId: mocks.resolveBankLedgerAccountId,
  };
});
vi.mock("@/server/fiscal/locks", () => ({ resolveOpenPostingDate: mocks.resolveOpenPostingDate, assertFiscalPeriodOpen: vi.fn() }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/treasury/bank-payments", () => ({
  createCustomerPaymentForBank: mocks.createCustomerPaymentForBank,
  createSupplierPaymentForBank: mocks.createSupplierPaymentForBank,
  removeTreasuryCustomerPayment: mocks.removeTreasuryCustomerPayment,
  removeTreasurySupplierPayment: mocks.removeTreasurySupplierPayment,
}));
vi.mock("@/server/treasury/reconciliation", () => ({ unreconcileBankTransaction: mocks.unreconcileBankTransaction }));
vi.mock("@/server/treasury/rules", () => ({ createReconciliationRule: mocks.createReconciliationRule }));
vi.mock("@/server/invoices/sql", () => ({}));

import { buildBankAssignmentLines } from "@/server/accounting/auto-post";
import { applyAllocationsInTx, undoReconciliationInTx } from "@/server/treasury/workbench";

/** Cliente simulado: cada select consume la siguiente respuesta; se registran inserts, updates y deletes. */
function clientWith(selectResults: unknown[][]) {
  const chain = () => {
    const value: Record<string, unknown> = {};
    for (const method of ["from", "where", "for", "limit", "innerJoin", "leftJoin", "orderBy"]) value[method] = vi.fn(() => value);
    value.then = (resolve: (input: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
    return value;
  };
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const deletes: number[] = [];
  return {
    inserts,
    updates,
    deletes,
    select: vi.fn(() => chain()),
    insert: vi.fn(() => ({ values: vi.fn(async (values: unknown) => { inserts.push(values); }) })),
    update: vi.fn(() => ({ set: vi.fn((values: unknown) => { updates.push(values); return { where: vi.fn(async () => undefined) }; }) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => { deletes.push(1); }) })),
  };
}

type Line = { accountId: string; debit: string | number; credit: string | number };

/** Saldo neto (debe − haber, en céntimos) por cuenta de una serie de asientos. */
function net(entries: Line[][]) {
  const totals = new Map<string, number>();
  for (const line of entries.flat()) {
    totals.set(line.accountId, (totals.get(line.accountId) ?? 0) + Math.round(Number(line.debit) * 100) - Math.round(Number(line.credit) * 100));
  }
  return Object.fromEntries([...totals.entries()].filter(([, cents]) => cents !== 0));
}

function reverse(lines: Line[]): Line[] {
  return lines.map((line) => ({ accountId: line.accountId, debit: line.credit, credit: line.debit }));
}

function sumSide(lines: Line[], side: "debit" | "credit") {
  return lines.reduce((sum, line) => sum + Math.round(Number(line[side]) * 100), 0);
}

const actor = { companyId: "company-1", tenantId: "tenant-1", actorUserId: "user-1", activeFiscalYearId: "fy-1" };
const fee = { id: "bt-1", bankAccountId: "bank-1", amount: "-12.50", description: "COMISION MANTENIMIENTO", reference: null, postedAt: new Date("2026-09-02"), status: "PENDING" };

describe("assign a bank movement to an account", () => {
  it("builds balanced entries: charges debit the account, deposits credit it, netted fees flip side", () => {
    const charge = buildBankAssignmentLines("bank", -12.5, [{ accountId: "626", amount: 12.5 }]);
    expect(charge).toEqual([{ accountId: "bank", debit: "0.00", credit: "12.50" }, { accountId: "626", debit: "12.50", credit: "0.00" }]);
    const deposit = buildBankAssignmentLines("bank", 40, [{ accountId: "769", amount: 40 }]);
    expect(deposit).toEqual([{ accountId: "bank", debit: "40.00", credit: "0.00" }, { accountId: "769", debit: "0.00", credit: "40.00" }]);
    const split = buildBankAssignmentLines("bank", -300, [{ accountId: "642", amount: 294 }, { accountId: "626", amount: 6 }]);
    expect(sumSide(split, "debit")).toBe(sumSide(split, "credit"));
    // Cobro neto de comisión: la partida de cuenta resta al ingreso (626 al debe, banco al haber).
    const netted = buildBankAssignmentLines("bank", 995, [{ accountId: "626", amount: -5 }]);
    expect(netted).toEqual([{ accountId: "bank", debit: "0.00", credit: "5.00" }, { accountId: "626", debit: "5.00", credit: "0.00" }]);
  });

  it("reverses 555 completely: bank keeps the statement amount and the expense account gets it", () => {
    // Asiento provisional del cargo: 555 al debe, banco al haber.
    const provisional: Line[] = [{ accountId: "555", debit: "12.50", credit: "0" }, { accountId: "bank", debit: "0", credit: "12.50" }];
    const assignment = buildBankAssignmentLines("bank", -12.5, [{ accountId: "626", amount: 12.5 }]);
    expect(net([provisional, reverse(provisional), assignment])).toEqual({ bank: -1250, 626: 1250 });
  });

  it("split receipt: invoice payments + netted fee leave bank = statement, 430 settled and 555 at zero", () => {
    const provisional: Line[] = [{ accountId: "bank", debit: "995", credit: "0" }, { accountId: "555", debit: "0", credit: "995" }];
    const payments: Line[][] = [
      [{ accountId: "bank", debit: "600", credit: "0" }, { accountId: "430", debit: "0", credit: "600" }],
      [{ accountId: "bank", debit: "400", credit: "0" }, { accountId: "430", debit: "0", credit: "400" }],
    ];
    const assignment = buildBankAssignmentLines("bank", 995, [{ accountId: "626", amount: -5 }]);
    expect(net([provisional, ...payments, reverse(provisional), assignment])).toEqual({ bank: 99500, 430: -100000, 626: 500 });
  });

  it("applies an account assignment: reverses the 555 entry, posts bank ↔ account, stores the allocation and remembers the rule", async () => {
    const client = clientWith([[fee], [{ id: "acc-626", code: "626", name: "Servicios bancarios" }]]);
    const result = await applyAllocationsInTx(client as never, actor, {
      transactionId: "bt-1",
      allocations: [{ type: "ACCOUNT", targetId: "acc-626", amount: 12.5 }],
      remember: { conceptContains: "comision", direction: "OUT", accountId: "acc-626" },
    });

    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "bankTransaction", sourceId: "bt-1", postedAt: fee.postedAt, dbClient: client }));
    expect(mocks.postBankTransactionAssignment).toHaveBeenCalledWith(expect.objectContaining({
      bankTransactionId: "bt-1",
      bankAccountId: "bank-1",
      movementAmount: -12.5,
      allocations: [{ accountId: "acc-626", amount: 12.5 }],
    }));
    expect(client.inserts[0]).toEqual([expect.objectContaining({ kind: "ACCOUNT", accountId: "acc-626", amount: "12.50", createdPayment: false })]);
    expect(client.updates[0]).toMatchObject({ reconciliationStatus: "RECONCILED", resolution: "ACCOUNT", matchedInvoicePaymentId: null });
    expect(mocks.createReconciliationRule).toHaveBeenCalledWith(actor, expect.objectContaining({ conceptContains: "comision" }), client);
    expect(result).toMatchObject({ resolution: "ACCOUNT", rememberedRuleId: "rule-new" });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "treasury.reconcile.apply" }), client);
  });

  it("refuses to assign to 555 or to the bank's own ledger account", async () => {
    await expect(applyAllocationsInTx(clientWith([[fee], [{ id: "acc-555", code: "555", name: "Partidas pendientes" }]]) as never, actor, {
      transactionId: "bt-1",
      allocations: [{ type: "ACCOUNT", targetId: "acc-555", amount: 12.5 }],
    })).rejects.toMatchObject({ status: 422 });
    await expect(applyAllocationsInTx(clientWith([[fee], [{ id: "acc-572001", code: "572001", name: "Banco" }]]) as never, actor, {
      transactionId: "bt-1",
      allocations: [{ type: "ACCOUNT", targetId: "acc-572001", amount: 12.5 }],
    })).rejects.toMatchObject({ status: 422 });
    expect(mocks.reverseAutomaticEntries).not.toHaveBeenCalled();
  });

  it("rejects splits that do not add up before touching the ledger", async () => {
    const deposit = { ...fee, amount: "350.00" };
    await expect(applyAllocationsInTx(clientWith([[deposit]]) as never, actor, {
      transactionId: "bt-1",
      allocations: [{ type: "CUSTOMER_INVOICE", targetId: "inv-a", amount: 200 }],
    })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/faltan 150\.00/) });
    expect(mocks.createCustomerPaymentForBank).not.toHaveBeenCalled();
  });

  it("splits a receipt across invoices creating one payment per invoice dated on the movement", async () => {
    const deposit = { ...fee, amount: "350.00", description: "TRANSF CLIENTE" };
    const client = clientWith([[deposit]]);
    const result = await applyAllocationsInTx(client as never, actor, {
      transactionId: "bt-1",
      allocations: [
        { type: "CUSTOMER_INVOICE", targetId: "inv-a", amount: 200 },
        { type: "CUSTOMER_INVOICE", targetId: "inv-b", amount: 150 },
      ],
    });
    expect(mocks.createCustomerPaymentForBank).toHaveBeenCalledTimes(2);
    expect(mocks.createCustomerPaymentForBank).toHaveBeenCalledWith(client, actor, expect.objectContaining({ invoiceId: "inv-a", amount: 200, bankAccountId: "bank-1", postedAt: deposit.postedAt }));
    expect(mocks.postBankTransactionAssignment).not.toHaveBeenCalled();
    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledTimes(1);
    expect(client.inserts[0]).toEqual([
      expect.objectContaining({ kind: "CUSTOMER_PAYMENT", paymentId: "pay-inv-a", invoicePaymentId: "ip-inv-a", createdPayment: true, amount: "200.00" }),
      expect.objectContaining({ kind: "CUSTOMER_PAYMENT", paymentId: "pay-inv-b", createdPayment: true, amount: "150.00" }),
    ]);
    expect(client.updates[0]).toMatchObject({ resolution: "PAYMENT", matchedInvoicePaymentId: null });
    expect(result.createdPayments).toEqual(["REC-inv-a", "REC-inv-b"]);
  });

  it("undo removes created payments, reverses the assignment and re-posts the movement against 555", async () => {
    const reconciled = { ...fee, status: "RECONCILED" };
    const client = clientWith([[reconciled], [
      { id: "al-1", kind: "CUSTOMER_PAYMENT", paymentId: "pay-1", supplierPaymentId: null, createdPayment: true },
      { id: "al-2", kind: "CUSTOMER_PAYMENT", paymentId: "pay-existing", supplierPaymentId: null, createdPayment: false },
      { id: "al-3", kind: "ACCOUNT", paymentId: null, supplierPaymentId: null, createdPayment: false },
    ]]);
    const result = await undoReconciliationInTx(client as never, actor, "bt-1");
    expect(mocks.removeTreasuryCustomerPayment).toHaveBeenCalledTimes(1);
    expect(mocks.removeTreasuryCustomerPayment).toHaveBeenCalledWith(client, actor, "pay-1");
    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "bankTransactionAssignment", sourceId: "bt-1" }));
    expect(mocks.postBankTransaction).toHaveBeenCalledWith(expect.objectContaining({ bankTransactionId: "bt-1", amount: -12.5, bankAccountId: "bank-1" }));
    expect(client.deletes).toHaveLength(1);
    expect(client.updates[0]).toMatchObject({ reconciliationStatus: "PENDING", resolution: null });
    expect(result).toEqual({ transactionId: "bt-1", removedPayments: 1 });
  });

  it("undo of a movement reconciled before the workbench uses the original unreconcile", async () => {
    const client = clientWith([[{ ...fee, status: "RECONCILED" }], []]);
    await undoReconciliationInTx(client as never, actor, "bt-1");
    expect(mocks.unreconcileBankTransaction).toHaveBeenCalled();
    expect(mocks.postBankTransaction).not.toHaveBeenCalled();
  });

  beforeEach(() => vi.clearAllMocks());
});
