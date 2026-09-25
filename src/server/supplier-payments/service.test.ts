import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reverseAutomaticEntries: vi.fn(async () => 1),
  postSupplierPayment: vi.fn(async () => undefined),
  recordAudit: vi.fn(async () => undefined),
  reserveSeriesNumber: vi.fn(async () => "PA000001"),
  assertFiscalPeriodOpen: vi.fn(async () => undefined),
  refreshSupplierInvoicePaymentStatus: vi.fn(async () => ({ paymentStatus: "PENDING" })),
  reconcileBankTransaction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/accounting/auto-post", () => ({ postSupplierPayment: mocks.postSupplierPayment, reverseAutomaticEntries: mocks.reverseAutomaticEntries, postCustomerPayment: vi.fn() }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: mocks.reserveSeriesNumber }));
vi.mock("@/server/fiscal/locks", () => ({ assertFiscalPeriodOpen: mocks.assertFiscalPeriodOpen }));
vi.mock("@/server/supplier-invoices/service", () => ({ refreshSupplierInvoicePaymentStatus: mocks.refreshSupplierInvoicePaymentStatus }));
vi.mock("@/server/treasury/reconciliation", () => ({ reconcileBankTransaction: mocks.reconcileBankTransaction }));
vi.mock("@/server/invoices/service", () => ({ getInvoiceBalance: vi.fn(), refreshInvoicePaymentStatus: vi.fn() }));

import { nextPurchaseOrderStatus, registerSupplierPayment, removeSupplierPayment } from "@/server/supplier-payments/service";

/** Transacción simulada: cada select consume la siguiente respuesta; se registran escrituras. */
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
    insert: vi.fn(() => ({ values: vi.fn((values: Record<string, unknown>) => { inserts.push(values); return { returning: vi.fn(async () => [{ id: `row-${inserts.length}`, ...values }]) }; }) })),
    update: vi.fn(() => ({ set: vi.fn((values: unknown) => { updates.push(values); return { where: vi.fn(async () => undefined) }; }) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => { deletes.push(1); }) })),
  };
}

const actor = { tenantId: "t", companyId: "c", actorUserId: "u", activeFiscalYearId: "fy" };

beforeEach(() => vi.clearAllMocks());

describe("estado del pedido de compra según el pago de sus facturas", () => {
  it("pasa a PAID cuando todas las facturas activas están pagadas", () => {
    expect(nextPurchaseOrderStatus({ currentStatus: "INVOICED", invoices: [{ status: "POSTED", paymentStatus: "PAID" }, { status: "VOID", paymentStatus: "VOID" }], hasGoodsReceipt: true })).toBe("PAID");
  });

  it("al deshacer un pago vuelve de PAID a INVOICED (o RECEIVED/APPROVED sin facturas activas)", () => {
    expect(nextPurchaseOrderStatus({ currentStatus: "PAID", invoices: [{ status: "POSTED", paymentStatus: "PARTIAL" }], hasGoodsReceipt: true })).toBe("INVOICED");
    expect(nextPurchaseOrderStatus({ currentStatus: "PAID", invoices: [], hasGoodsReceipt: true })).toBe("RECEIVED");
    expect(nextPurchaseOrderStatus({ currentStatus: "PAID", invoices: [], hasGoodsReceipt: false })).toBe("APPROVED");
  });

  it("no toca pedidos que no estaban pagados", () => {
    expect(nextPurchaseOrderStatus({ currentStatus: "RECEIVED", invoices: [{ status: "POSTED", paymentStatus: "PENDING" }], hasGoodsReceipt: true })).toBe("RECEIVED");
  });
});

describe("registerSupplierPayment", () => {
  it("rechaza pagar más de lo pendiente con un 400", async () => {
    const client = clientWith([
      [{ id: "si-1", number: "FP-1", supplierPartnerId: "p-1", purchaseOrderId: null, totalAmount: "100.00", status: "POSTED" }],
      [{ id: "p-1" }],
      [{ amountApplied: "80.00" }],
    ]);
    await expect(registerSupplierPayment(actor, { supplierInvoiceId: "si-1", amountApplied: 30, postedAt: new Date("2026-09-01") }, client as never)).rejects.toMatchObject({ status: 400, code: "SUPPLIER_INVOICE_OVERPAYMENT" });
  });

  it("registra el pago en la transacción recibida, contabiliza con el banco del movimiento y marca el pedido como pagado", async () => {
    const client = clientWith([
      [{ id: "si-1", number: "FP-1", supplierPartnerId: "p-1", purchaseOrderId: "po-1", totalAmount: "100.00", status: "POSTED" }],
      [{ id: "p-1" }],
      [{ id: "bank-1" }],
      [],
      [{ id: "pm-bank" }],
      // refresco: factura y pedido
      [{ status: "POSTED", purchaseOrderId: "po-1" }],
      [{ id: "po-1", status: "INVOICED" }],
      [{ status: "POSTED", paymentStatus: "PAID" }],
      [{ id: "gr-1" }],
    ]);
    const result = await registerSupplierPayment(actor, { supplierInvoiceId: "si-1", amountApplied: 100, postedAt: new Date("2026-09-01"), bankAccountId: "bank-1", origin: "treasury" }, client as never);
    expect(result.application).toMatchObject({ supplierInvoiceId: "si-1", amountApplied: "100.00" });
    expect(mocks.reserveSeriesNumber).toHaveBeenCalledWith(client, expect.objectContaining({ type: "PAYMENT" }));
    expect(mocks.postSupplierPayment).toHaveBeenCalledWith(expect.objectContaining({ bankAccountId: "bank-1", paymentMethodId: "pm-bank", reference: "Pago factura proveedor FP-1", dbClient: client }));
    expect(mocks.refreshSupplierInvoicePaymentStatus).toHaveBeenCalledWith("c", "si-1", client);
    expect(client.updates).toContainEqual({ status: "PAID" });
  });
});

describe("removeSupplierPayment", () => {
  it("revierte el asiento, borra el pago y devuelve factura y pedido a su estado", async () => {
    const client = clientWith([
      [{ id: "sp-1", supplierInvoiceId: "si-1", number: "PA000001", postedAt: new Date("2026-09-01"), amount: "100.00" }],
      [{ status: "POSTED", purchaseOrderId: "po-1" }],
      [{ id: "po-1", status: "PAID" }],
      [{ status: "POSTED", paymentStatus: "PENDING" }],
      [{ id: "gr-1" }],
    ]);
    await expect(removeSupplierPayment(actor, "sp-1", { origin: "sepa.undo" }, client as never)).resolves.toBe(true);
    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "supplierPayment", sourceId: "sp-1", dbClient: client }));
    expect(client.deletes).toHaveLength(1);
    expect(mocks.refreshSupplierInvoicePaymentStatus).toHaveBeenCalledWith("c", "si-1", client);
    expect(client.updates).toContainEqual({ status: "INVOICED" });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "supplier_payment.delete", payload: expect.objectContaining({ origin: "sepa.undo" }) }), client);
  });

  it("devuelve false si el pago no existe", async () => {
    await expect(removeSupplierPayment(actor, "missing", {}, clientWith([[]]) as never)).resolves.toBe(false);
  });
});
