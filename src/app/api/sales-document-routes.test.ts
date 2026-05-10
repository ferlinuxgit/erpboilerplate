import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  ensureUserTenant: vi.fn(),
  can: vi.fn(),
  reserveSeriesNumber: vi.fn(),
  refreshStockLocation: vi.fn(),
  registerInMovementCost: vi.fn(),
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("@/lib/current-user", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant: mocks.ensureUserTenant }));
vi.mock("@/lib/rbac", () => ({ can: mocks.can }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: mocks.reserveSeriesNumber }));
vi.mock("@/server/inventory/stock-location", () => ({
  refreshStockLocation: mocks.refreshStockLocation,
  registerInMovementCost: mocks.registerInMovementCost,
}));

const session = {
  user: {
    id: "user_1",
    name: "Owner User",
    email: "owner@example.com",
  },
};

const tenantContext = {
  tenant: { id: "tenant_1", name: "Tenant", slug: "tenant" },
  company: { id: "company_1", name: "Company", baseCurrencyCode: "EUR" },
  fiscalYear: { id: "fy_1", code: "2026" },
  membership: { id: "membership_1", role: "OWNER" },
};

function jsonRequest(path: string, payload: unknown) {
  return new Request(`https://erp.example.com${path}`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
}

function queuedSelect(rows: unknown[][]) {
  return vi.fn(() => {
    const chain = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(rows.shift() ?? [])),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows.shift() ?? []).then(resolve, reject),
    };
    return chain;
  });
}

function makeTransactionClient(options: { selectRows?: unknown[][]; insertReturningRows?: unknown[][] } = {}) {
  const selectRows = options.selectRows ?? [];
  const insertReturningRows = options.insertReturningRows ?? [];
  const insert = vi.fn(() => {
    const builder = {
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(insertReturningRows.shift() ?? [])),
      })),
    };
    return builder;
  });
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
  }));

  return {
    select: queuedSelect(selectRows),
    insert,
    update,
  };
}

describe("sales document route tenant boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSession.mockResolvedValue(session);
    mocks.ensureUserTenant.mockResolvedValue(tenantContext);
    mocks.can.mockReturnValue(true);
    mocks.reserveSeriesNumber.mockResolvedValue("AUTO-1");
    mocks.refreshStockLocation.mockResolvedValue(undefined);
    mocks.registerInMovementCost.mockResolvedValue(undefined);
  });

  it("rejects creating a sales order from a quote outside the current company before mutating data", async () => {
    mocks.db.select.mockImplementation(queuedSelect([[{ id: "customer_1" }], []]));
    mocks.db.transaction.mockResolvedValue({ id: "order_should_not_exist" });
    const { POST } = await import("@/app/api/sales-orders/route");

    const response = await POST(
      jsonRequest("/api/sales-orders", {
        customerId: "customer_1",
        salesQuoteId: "quote_from_other_company",
        issueDate: "2026-05-09",
        subtotal: 100,
        taxAmount: 21,
        retentionAmount: 0,
        totalAmount: 121,
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ message: "Presupuesto no encontrado." });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("allows creating a sales order from an owned quote and copies the quote lines", async () => {
    mocks.db.select.mockImplementation(queuedSelect([[{ id: "customer_1" }], [{ id: "quote_1", customerId: "customer_1" }]]));
    const tx = makeTransactionClient({
      selectRows: [
        [
          {
            itemId: "item_1",
            description: "Consultoría",
            quantity: "2",
            unitPrice: "50.00",
            discountPct: "0",
            taxRate: "21",
            retentionRate: "0",
            lineTotal: "100.00",
          },
        ],
      ],
      insertReturningRows: [[{ id: "order_1", salesQuoteId: "quote_1" }]],
    });
    mocks.db.transaction.mockImplementation(async (callback) => callback(tx));
    const { POST } = await import("@/app/api/sales-orders/route");

    const response = await POST(
      jsonRequest("/api/sales-orders", {
        customerId: "customer_1",
        salesQuoteId: "quote_1",
        issueDate: "2026-05-09",
        subtotal: 100,
        taxAmount: 21,
        retentionAmount: 0,
        totalAmount: 121,
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "order_1", salesQuoteId: "quote_1" });
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(tx.insert).toHaveBeenCalledTimes(2);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("rejects creating a delivery note from an order outside the current company before mutating data", async () => {
    mocks.db.select.mockImplementation(queuedSelect([[{ id: "customer_1" }], [{ id: "warehouse_1" }], []]));
    mocks.db.transaction.mockResolvedValue({ id: "delivery_should_not_exist" });
    const { POST } = await import("@/app/api/delivery-notes/route");

    const response = await POST(
      jsonRequest("/api/delivery-notes", {
        customerId: "customer_1",
        warehouseId: "warehouse_1",
        salesOrderId: "order_from_other_company",
        issuedAt: "2026-05-09",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ message: "Pedido no encontrado." });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("allows creating a delivery note from an owned order and copies the order lines", async () => {
    mocks.db.select.mockImplementation(
      queuedSelect([
        [{ id: "customer_1" }],
        [{ id: "warehouse_1" }],
        [{ id: "order_1", customerId: "customer_1" }],
        [{ itemId: "item_1" }],
      ]),
    );
    const tx = makeTransactionClient({
      selectRows: [[{ itemId: "item_1", description: "Consultoría", quantity: "2" }]],
      insertReturningRows: [[{ id: "delivery_1", salesOrderId: "order_1" }], [{ itemId: "item_1", quantity: "2" }]],
    });
    mocks.db.transaction.mockImplementation(async (callback) => callback(tx));
    const { POST } = await import("@/app/api/delivery-notes/route");

    const response = await POST(
      jsonRequest("/api/delivery-notes", {
        customerId: "customer_1",
        warehouseId: "warehouse_1",
        salesOrderId: "order_1",
        issuedAt: "2026-05-09",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "delivery_1", salesOrderId: "order_1" });
    expect(mocks.db.select).toHaveBeenCalledTimes(3);
    expect(tx.insert).toHaveBeenCalledTimes(3);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(mocks.refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company_1", itemId: "item_1", warehouseId: "warehouse_1" },
      tx,
    );
  });
});

describe("purchase goods receipt stock atomicity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSession.mockResolvedValue(session);
    mocks.ensureUserTenant.mockResolvedValue(tenantContext);
    mocks.can.mockReturnValue(true);
    mocks.refreshStockLocation.mockResolvedValue(undefined);
    mocks.registerInMovementCost.mockResolvedValue(undefined);
  });

  function makeGoodsReceiptTransaction() {
    const tx = makeTransactionClient({
      selectRows: [
        [{ itemId: "item_1", quantity: "3.000" }],
        [{ unitPrice: "11.50" }],
      ],
      insertReturningRows: [
        [{ id: "receipt_1", purchaseOrderId: "po_1" }],
        [{ itemId: "item_1", quantity: "3.000" }],
        [{ id: "movement_1" }],
      ],
    });
    return tx;
  }

  it("records receipt lines, stock movement, cost, and stock snapshot inside one transaction", async () => {
    mocks.db.select.mockImplementation(queuedSelect([[{ id: "po_1" }], [{ id: "warehouse_1" }]]));
    const tx = makeGoodsReceiptTransaction();
    mocks.db.transaction.mockImplementation(async (callback) => callback(tx));
    const { POST } = await import("@/app/api/goods-receipts/route");

    const response = await POST(
      jsonRequest("/api/goods-receipts", {
        purchaseOrderId: "po_1",
        warehouseId: "warehouse_1",
        receivedAt: "2026-05-09",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "receipt_1", purchaseOrderId: "po_1" });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(3);
    expect(mocks.registerInMovementCost).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company_1",
        itemId: "item_1",
        movementId: "movement_1",
        quantity: 3,
        unitCost: 11.5,
      }),
      tx,
    );
    expect(mocks.refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company_1", itemId: "item_1", warehouseId: "warehouse_1" },
      tx,
    );
  });

  it("rolls back the goods receipt transaction when stock snapshot refresh fails", async () => {
    mocks.db.select.mockImplementation(queuedSelect([[{ id: "po_1" }], [{ id: "warehouse_1" }]]));
    mocks.refreshStockLocation.mockRejectedValueOnce(new Error("stock refresh failed"));
    const tx = makeGoodsReceiptTransaction();
    const state = { committed: false, rolledBack: false };
    mocks.db.transaction.mockImplementation(async (callback) => {
      try {
        const result = await callback(tx);
        state.committed = true;
        return result;
      } catch (error) {
        state.rolledBack = true;
        throw error;
      }
    });
    const { POST } = await import("@/app/api/goods-receipts/route");

    await expect(
      POST(
        jsonRequest("/api/goods-receipts", {
          purchaseOrderId: "po_1",
          warehouseId: "warehouse_1",
          receivedAt: "2026-05-09",
        }),
      ),
    ).rejects.toThrow("stock refresh failed");

    expect(tx.insert).toHaveBeenCalledTimes(3);
    expect(mocks.registerInMovementCost).toHaveBeenCalledWith(
      expect.objectContaining({ movementId: "movement_1", itemId: "item_1" }),
      tx,
    );
    expect(mocks.refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company_1", itemId: "item_1", warehouseId: "warehouse_1" },
      tx,
    );
    expect(state).toEqual({ committed: false, rolledBack: true });
  });
});
