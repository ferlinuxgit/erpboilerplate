import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const inserted: unknown[] = [];
  const selection = () => {
    const builder = {
      from: () => builder,
      where: () => builder,
      for: () => builder,
      orderBy: () => builder,
      limit: async () => selectResults.shift() ?? [],
    };
    return builder;
  };
  const deleted: unknown[] = [];
  const tx = {
    delete: vi.fn((table: unknown) => ({ where: async () => { deleted.push(table); } })),
    select: vi.fn(selection),
    insert: vi.fn(() => ({
      values: (value: unknown) => {
        inserted.push(value);
        return { returning: async () => [{ id: `row-${inserted.length}`, ...(value as object) }] };
      },
    })),
  };
  return {
    selectResults,
    inserted,
    deleted,
    tx,
    db: { transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) },
    getInvoiceBalance: vi.fn(),
    refreshInvoicePaymentStatus: vi.fn(async () => null),
    postCustomerPayment: vi.fn(async () => undefined),
    reverseAutomaticEntries: vi.fn(async () => 1),
    assertFiscalPeriodOpen: vi.fn(async () => undefined),
    recordAudit: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
    reserveSeriesNumber: vi.fn(async () => "CO000001"),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/invoices/service", () => ({ getInvoiceBalance: mocks.getInvoiceBalance, refreshInvoicePaymentStatus: mocks.refreshInvoicePaymentStatus }));
vi.mock("@/server/accounting/auto-post", () => ({ postCustomerPayment: mocks.postCustomerPayment, reverseAutomaticEntries: mocks.reverseAutomaticEntries }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: mocks.reserveSeriesNumber }));
vi.mock("@/server/fiscal/locks", () => ({ assertFiscalPeriodOpen: mocks.assertFiscalPeriodOpen }));
vi.mock("@/server/treasury/reconciliation", () => ({ reconcileBankTransaction: vi.fn(async () => undefined) }));

import { registerInvoicePayment, removeInvoicePayment } from "@/server/invoices/payments";

const actor = { tenantId: "t", companyId: "c", actorUserId: "u", activeFiscalYearId: "fy" };
const input = { invoiceId: "inv-1", amountApplied: 100, postedAt: new Date("2026-05-10T00:00:00.000Z"), paymentMethodId: "pm-1" };
const issued = { id: "inv-1", number: "FA000001", totalAmount: "374.00", status: "SENT", issuedAt: new Date(), invoiceType: "INVOICE" };

beforeEach(() => {
  mocks.selectResults.length = 0;
  mocks.inserted.length = 0;
  mocks.deleted.length = 0;
  vi.clearAllMocks();
  mocks.getInvoiceBalance.mockResolvedValue({ totalCents: 37400, creditedCents: -12100, paidCents: 0, outstandingCents: 25300, paymentStatus: "PENDING" });
});

describe("registerInvoicePayment", () => {
  it("rechaza cobrar un borrador", async () => {
    mocks.selectResults.push([{ ...issued, status: "DRAFT", number: "BORRADOR-1234ABCD", issuedAt: null }]);
    await expect(registerInvoicePayment(actor, input)).rejects.toMatchObject({ status: 409 });
  });

  it("rechaza cobrar una rectificativa", async () => {
    mocks.selectResults.push([{ ...issued, invoiceType: "CREDIT_NOTE" }]);
    await expect(registerInvoicePayment(actor, input)).rejects.toMatchObject({ status: 409 });
  });

  it("limita el cobro al saldo pendiente (total − rectificativas − cobros)", async () => {
    mocks.selectResults.push([issued], [{ id: "pm-1" }]);
    await expect(registerInvoicePayment(actor, { ...input, amountApplied: 300 })).rejects.toMatchObject({ status: 400 });
  });

  it("registra el cobro, numera el recibo por fecha de cobro, contabiliza y audita en la transacción", async () => {
    mocks.selectResults.push([issued], [{ id: "pm-1" }]);
    await registerInvoicePayment(actor, { ...input, amountApplied: 253 });

    expect(mocks.reserveSeriesNumber).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ type: "RECEIPT", referenceDate: input.postedAt }));
    expect(mocks.refreshInvoicePaymentStatus).toHaveBeenCalledWith(mocks.tx, "c", "inv-1");
    expect(mocks.postCustomerPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 253, reference: "Cobro factura FA000001" }));
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.payment.create", entityId: "inv-1" }), mocks.tx);
  });

  it("runs inside the caller transaction and, from a bank, uses the bank's payment method and subaccount", async () => {
    // Factura y forma de pago del banco (paymentMethodForBankAccount).
    mocks.selectResults.push([issued], [{ id: "pm-bank" }]);
    const result = await registerInvoicePayment(actor, { invoiceId: "inv-1", amountApplied: 100, postedAt: input.postedAt, bankAccountId: "bank-1", origin: "sepa", reference: "Remesa ADE1 · ADE1-1" }, mocks.tx as never);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(result.invoiceNumber).toBe("FA000001");
    expect(mocks.inserted[0]).toMatchObject({ paymentMethodId: "pm-bank", amount: "100.00" });
    expect(mocks.postCustomerPayment).toHaveBeenCalledWith(expect.objectContaining({ bankAccountId: "bank-1", paymentMethodId: "pm-bank", reference: "Remesa ADE1 · ADE1-1" }));
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ origin: "sepa", bankAccountId: "bank-1" }) }), mocks.tx);
  });

  it("requires a payment method when the payment does not come from a bank", async () => {
    mocks.selectResults.push([issued]);
    await expect(registerInvoicePayment(actor, { ...input, paymentMethodId: undefined })).rejects.toMatchObject({ status: 400, code: "PAYMENT_METHOD_REQUIRED" });
  });
});

describe("removeInvoicePayment (undo / returned direct debit)", () => {
  it("reverses the entry on the return date, deletes the payment and puts the invoice back to pending", async () => {
    const payment = { id: "pay-1", invoiceId: "inv-1", number: "CO000001", postedAt: new Date("2026-09-01T00:00:00.000Z"), amount: "100.00" };
    mocks.selectResults.push([payment]);
    const returnedAt = new Date("2026-09-10T00:00:00.000Z");
    await expect(removeInvoicePayment(actor, "pay-1", { postedAt: returnedAt, origin: "sepa.return" }, mocks.tx as never)).resolves.toBe(true);
    expect(mocks.assertFiscalPeriodOpen).toHaveBeenCalledWith("c", returnedAt, mocks.tx);
    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "payment", sourceId: "pay-1", postedAt: returnedAt, dbClient: mocks.tx }));
    expect(mocks.deleted).toHaveLength(1);
    expect(mocks.refreshInvoicePaymentStatus).toHaveBeenCalledWith(mocks.tx, "c", "inv-1");
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.payment.delete", payload: expect.objectContaining({ origin: "sepa.return" }) }), mocks.tx);
  });

  it("returns false when the payment does not exist", async () => {
    mocks.selectResults.push([]);
    await expect(removeInvoicePayment(actor, "missing")).resolves.toBe(false);
    expect(mocks.reverseAutomaticEntries).not.toHaveBeenCalled();
  });
});
