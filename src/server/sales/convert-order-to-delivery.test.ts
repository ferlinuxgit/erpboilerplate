import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  insertedValues: [] as unknown[],
  insertResults: [] as unknown[],
  updateSets: [] as unknown[],
  db: {
    transaction: vi.fn(),
    select: vi.fn(),
  },
  tx: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  reserveSeriesNumber: vi.fn(),
  refreshStockLocation: vi.fn(),
  recordAudit: vi.fn(),
  postSalesInvoice: vi.fn(),
}));

function buildSelectChain() {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(mocks.selectResults.shift() ?? [])),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(mocks.selectResults.shift() ?? []).then(resolve, reject),
  };
  return chain;
}

function buildInsertChain() {
  const values = vi.fn((payload: unknown) => {
    mocks.insertedValues.push(payload);
    return {
      returning: vi.fn(() => Promise.resolve(mocks.insertResults.shift() ?? [])),
    };
  });
  return { values };
}

function buildUpdateChain() {
  return {
    set: vi.fn((payload: unknown) => {
      mocks.updateSets.push(payload);
      return { where: vi.fn(() => Promise.resolve([])) };
    }),
  };
}

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: mocks.reserveSeriesNumber }));
vi.mock("@/server/inventory/stock-location", () => ({ refreshStockLocation: mocks.refreshStockLocation }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/accounting/auto-post", () => ({ postSalesInvoice: mocks.postSalesInvoice }));

describe("convertOrderToDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.splice(0, mocks.selectResults.length);
    mocks.insertedValues.splice(0, mocks.insertedValues.length);
    mocks.insertResults.splice(0, mocks.insertResults.length);
    mocks.updateSets.splice(0, mocks.updateSets.length);
    mocks.tx.select.mockImplementation(buildSelectChain);
    mocks.tx.insert.mockImplementation(buildInsertChain);
    mocks.tx.update.mockImplementation(buildUpdateChain);
    mocks.db.transaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.reserveSeriesNumber.mockResolvedValue("ALB-000042");
    mocks.refreshStockLocation.mockResolvedValue(undefined);
    mocks.recordAudit.mockResolvedValue(undefined);
  });

  it("copies order lines and records delivery stock movements atomically", async () => {
    const { convertOrderToDelivery } = await import("@/server/sales/service");
    mocks.selectResults.splice(0, mocks.selectResults.length,
      [{ id: "order-1", companyId: "company-1", customerId: "customer-1", status: "CONFIRMED" }],
      [{ id: "warehouse-1" }],
      [{ id: "series-1", prefix: "ALB-", nextNumber: 42 }],
      [
        { itemId: "item-1", description: "Widget", quantity: "2.000" },
        { itemId: null, description: "Service", quantity: "1.000" },
      ],
    );
    mocks.insertResults.splice(0, mocks.insertResults.length,
      [{ id: "delivery-1", number: "ALB-000042" }],
      [
        { itemId: "item-1", quantity: "2.000" },
        { itemId: null, quantity: "1.000" },
      ],
      [{ id: "movement-1" }],
    );

    const result = await convertOrderToDelivery({
      tenantId: "tenant-1",
      companyId: "company-1",
      actorUserId: "user-1",
      fiscalYearId: "fy-1",
      salesOrderId: "order-1",
      warehouseId: "warehouse-1",
    });

    expect(result).toMatchObject({ id: "delivery-1" });
    expect(mocks.insertedValues).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({ deliveryNoteId: "delivery-1", itemId: "item-1", quantity: "2.000" }),
          expect.objectContaining({ deliveryNoteId: "delivery-1", itemId: null, quantity: "1.000" }),
        ],
        expect.objectContaining({
          companyId: "company-1",
          itemId: "item-1",
          warehouseId: "warehouse-1",
          movementType: "OUT",
          quantity: "2.000",
        }),
      ]),
    );
    expect(mocks.refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "warehouse-1" },
      mocks.tx,
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      companyId: "company-1",
      actorUserId: "user-1",
      entityName: "delivery_note",
      action: "sales.delivery.create",
      entityId: "delivery-1",
    }), mocks.tx);
  });
});
