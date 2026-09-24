import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const inserted: unknown[] = [];
  const selection = () => {
    const builder = {
      from: () => builder,
      where: () => builder,
      for: () => builder,
      limit: async () => selectResults.shift() ?? [],
    };
    return builder;
  };
  const tx = {
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
    tx,
    db: { transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) },
    getInvoiceBalance: vi.fn(),
    refreshInvoicePaymentStatus: vi.fn(async () => null),
    postCustomerPayment: vi.fn(async () => undefined),
    recordAudit: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
    reserveSeriesNumber: vi.fn(async () => "CO000001"),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/invoices/service", () => ({ getInvoiceBalance: mocks.getInvoiceBalance, refreshInvoicePaymentStatus: mocks.refreshInvoicePaymentStatus }));
vi.mock("@/server/accounting/auto-post", () => ({ postCustomerPayment: mocks.postCustomerPayment }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: mocks.reserveSeriesNumber }));
vi.mock("@/server/fiscal/locks", () => ({ assertFiscalPeriodOpen: vi.fn(async () => undefined) }));
vi.mock("@/server/treasury/reconciliation", () => ({ reconcileBankTransaction: vi.fn(async () => undefined) }));

import { registerInvoicePayment } from "@/server/invoices/payments";

const actor = { tenantId: "t", companyId: "c", actorUserId: "u", activeFiscalYearId: "fy" };
const input = { invoiceId: "inv-1", amountApplied: 100, postedAt: new Date("2026-05-10T00:00:00.000Z"), paymentMethodId: "pm-1" };
const issued = { id: "inv-1", number: "FA000001", totalAmount: "374.00", status: "SENT", issuedAt: new Date(), invoiceType: "INVOICE" };

beforeEach(() => {
  mocks.selectResults.length = 0;
  mocks.inserted.length = 0;
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
});
