import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const returning = vi.fn();
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const deleteReturning = vi.fn();
  const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
  const deleteFn = vi.fn(() => ({ where: deleteWhere }));
  const tx = { select, insert, update, delete: deleteFn };
  const transaction = vi.fn(async (callback) => callback(tx));
  const recordAudit = vi.fn();

  return { deleteFn, deleteReturning, insert, limit, recordAudit, returning, select, transaction, tx, update, updateReturning, values };
});

vi.mock("@/lib/db", () => ({ db: { delete: mocks.deleteFn, transaction: mocks.transaction, update: mocks.update } }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: vi.fn() }));

import {
  assertGoodsReceiptCanInvoice,
  assertPurchaseOrderCanReceive,
  assertSupplierInvoiceCanBePaid,
  createPurchaseOrder,
  deletePurchaseOrder,
  updatePurchaseOrder,
} from "@/server/purchases/service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue([{ id: "supplier-1" }]);
  mocks.returning.mockResolvedValue([{ id: "purchase-1", number: "PO-1", status: "DRAFT" }]);
  mocks.updateReturning.mockResolvedValue([{ id: "purchase-1", number: "PO-2", status: "CONFIRMED" }]);
  mocks.deleteReturning.mockResolvedValue([{ id: "purchase-1" }]);
});

describe("purchase document service transitions", () => {
  it("allows valid purchase pipeline transitions", () => {
    expect(() => assertPurchaseOrderCanReceive({ status: "DRAFT", hasReceipt: false, hasLines: true })).not.toThrow();
    expect(() => assertGoodsReceiptCanInvoice({ hasSupplierInvoice: false, hasLines: true })).not.toThrow();
    expect(() => assertSupplierInvoiceCanBePaid({ totalAmount: 120, paidAmount: 20 })).not.toThrow();
  });

  it("explains why invalid purchase transitions are blocked", () => {
    expect(() => assertPurchaseOrderCanReceive({ status: "CANCELLED", hasReceipt: false, hasLines: true })).toThrow(/anulado/);
    expect(() => assertPurchaseOrderCanReceive({ status: "DRAFT", hasReceipt: false, hasLines: false })).toThrow(/Añade al menos una línea/);
    expect(() => assertGoodsReceiptCanInvoice({ hasSupplierInvoice: true, hasLines: true })).toThrow(/Ya existe una factura/);
    expect(() => assertSupplierInvoiceCanBePaid({ totalAmount: 120, paidAmount: 120 })).toThrow(/ya está pagada/);
  });
});

describe("createPurchaseOrder", () => {
  it("records the audit entry inside the purchase creation transaction", async () => {
    await createPurchaseOrder("company-1", "tenant-1", "actor-1", {
      supplierName: "Supplier A",
      number: "PO-1",
      fiscalYearId: "fy-1",
    });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "actor-1",
        action: "purchase.create",
        entityName: "purchaseOrder",
        entityId: "purchase-1",
      }),
      mocks.tx,
    );
  });

  it("records the update audit entry inside the purchase update transaction", async () => {
    await updatePurchaseOrder("company-1", "tenant-1", "actor-1", "purchase-1", { number: "PO-2", status: "CONFIRMED" });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "actor-1",
        action: "purchase.update",
        entityName: "purchaseOrder",
        entityId: "purchase-1",
      }),
      mocks.tx,
    );
  });

  it("records the delete audit entry inside the purchase delete transaction", async () => {
    await deletePurchaseOrder("company-1", "tenant-1", "actor-1", "purchase-1");

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "actor-1",
        action: "purchase.delete",
        entityName: "purchaseOrder",
        entityId: "purchase-1",
      }),
      mocks.tx,
    );
  });
});
