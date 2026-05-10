import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const returning = vi.fn();
  const values = vi.fn(() => ({ returning }));
  const createSelect = vi.fn(() => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selectRows.shift() ?? []),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(selectRows.shift() ?? []).then(resolve, reject),
    };
    return chain;
  });
  const insert = vi.fn(() => ({ values }));
  const txInsert = vi.fn(() => ({ values }));
  const txSelect = vi.fn(createSelect);
  const tx = { insert: txInsert, select: txSelect };
  const transactions: Array<{ committed: boolean; rolledBack: boolean; error?: unknown }> = [];
  const transaction = vi.fn(async (callback) => {
    const state: { committed: boolean; rolledBack: boolean; error?: unknown } = { committed: false, rolledBack: false };
    transactions.push(state);
    try {
      const result = await callback(tx);
      state.committed = true;
      return result;
    } catch (error) {
      state.rolledBack = true;
      state.error = error;
      throw error;
    }
  });
  const refreshStockLocation = vi.fn();

  return { insert, refreshStockLocation, returning, selectRows, transaction, transactions, tx, txInsert, txSelect, values };
});

vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert, transaction: mocks.transaction } }));
vi.mock("@/server/inventory/stock-location", () => ({ refreshStockLocation: mocks.refreshStockLocation }));

import { registerStockMovementOperation } from "./stock-movement-service";

const { refreshStockLocation, returning, values } = mocks;

const movedAt = new Date("2026-05-09T08:00:00.000Z");

describe("registerStockMovementOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows.splice(0, mocks.selectRows.length);
    mocks.transactions.splice(0, mocks.transactions.length);
    returning.mockResolvedValue([{ id: "movement-1" }]);
  });

  it("records a receipt and refreshes the affected stock location inside the same transaction", async () => {
    const created = await registerStockMovementOperation({
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-main",
      movementType: "IN",
      quantity: 7,
      movedAt,
      reason: "Recepción proveedor",
      reference: "ALB-100",
    });

    expect(created).toEqual([{ id: "movement-1" }]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.txInsert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        companyId: "company-1",
        itemId: "item-1",
        warehouseId: "wh-main",
        movementType: "IN",
        quantity: "7.000",
        movedAt,
        reason: "Recepción proveedor",
        reference: "ALB-100",
      }),
    ]);
    expect(refreshStockLocation).toHaveBeenCalledTimes(1);
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-main" },
      mocks.tx,
    );
  });

  it("records an outbound movement as a positive OUT quantity and refreshes stock", async () => {
    await registerStockMovementOperation({
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-main",
      movementType: "OUT",
      quantity: 2,
      movedAt,
      reason: "Salida operativa",
      reference: "SAL-20",
    });

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ movementType: "OUT", quantity: "2.000", reason: "Salida operativa", reference: "SAL-20" }),
    ]);
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-main" },
      mocks.tx,
    );
  });

  it("returns existing referenced movements without inserting or refreshing stock on retry", async () => {
    const existing = [{ id: "movement-existing", reference: "ALB-100", warehouseId: "wh-main" }];
    mocks.selectRows.push(existing);

    const result = await registerStockMovementOperation({
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-main",
      movementType: "IN",
      quantity: 7,
      movedAt,
      reason: "Recepción proveedor",
      reference: "ALB-100",
    });

    expect(result).toEqual(existing);
    expect(mocks.txSelect).toHaveBeenCalledTimes(1);
    expect(mocks.txInsert).not.toHaveBeenCalled();
    expect(refreshStockLocation).not.toHaveBeenCalled();
  });

  it("does not collapse a referenced retry onto an existing movement from another warehouse", async () => {
    const existingOtherWarehouse = [{ id: "movement-existing", reference: "ADJ-200", warehouseId: "wh-west" }];
    const created = [{ id: "movement-created", reference: "ADJ-200", warehouseId: "wh-east" }];
    mocks.selectRows.push(existingOtherWarehouse);
    returning.mockResolvedValueOnce(created);

    const result = await registerStockMovementOperation({
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-east",
      movementType: "ADJUSTMENT",
      quantity: 3,
      movedAt,
      reason: "Ajuste almacén este",
      reference: "ADJ-200",
    });

    expect(result).toEqual(created);
    expect(mocks.txInsert).toHaveBeenCalledTimes(1);
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-east" },
      mocks.tx,
    );
  });

  it("is retry-safe across repeated referenced operations by inserting only the first attempt", async () => {
    const created = [{ id: "movement-created", reference: "ALB-101", warehouseId: "wh-main" }];
    const existing = [{ id: "movement-created", reference: "ALB-101", warehouseId: "wh-main" }];
    returning.mockResolvedValueOnce(created);
    mocks.selectRows.push([], existing);

    const input = {
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-main",
      movementType: "IN" as const,
      quantity: 7,
      movedAt,
      reason: "Recepción proveedor",
      reference: "ALB-101",
    };

    await expect(registerStockMovementOperation(input)).resolves.toEqual(created);
    await expect(registerStockMovementOperation(input)).resolves.toEqual(existing);

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.txInsert).toHaveBeenCalledTimes(1);
    expect(refreshStockLocation).toHaveBeenCalledTimes(1);
    expect(mocks.transactions).toEqual([
      expect.objectContaining({ committed: true, rolledBack: false }),
      expect.objectContaining({ committed: true, rolledBack: false }),
    ]);
  });

  it("rolls back the movement transaction when stock location refresh fails", async () => {
    const refreshError = new Error("refresh failed");
    mocks.selectRows.push([]);
    refreshStockLocation.mockRejectedValueOnce(refreshError);

    await expect(
      registerStockMovementOperation({
        companyId: "company-1",
        itemId: "item-1",
        warehouseId: "wh-main",
        movementType: "IN",
        quantity: 7,
        movedAt,
        reason: "Recepción proveedor",
        reference: "ALB-102",
      }),
    ).rejects.toThrow(/refresh failed/);

    expect(mocks.txInsert).toHaveBeenCalledTimes(1);
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-main" },
      mocks.tx,
    );
    expect(mocks.transactions).toEqual([expect.objectContaining({ committed: false, rolledBack: true, error: refreshError })]);
  });

  it("records a transfer as balanced source/destination entries and refreshes both locations", async () => {
    await registerStockMovementOperation({
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-source",
      destinationWarehouseId: "wh-destination",
      movementType: "TRANSFER",
      quantity: 4,
      movedAt,
      reason: "Rebalanceo",
      reference: "TR-42",
    });

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ warehouseId: "wh-source", movementType: "TRANSFER", quantity: "-4.000", reference: "TR-42" }),
      expect.objectContaining({ warehouseId: "wh-destination", movementType: "TRANSFER", quantity: "4.000", reference: "TR-42" }),
    ]);
    expect(refreshStockLocation).toHaveBeenCalledTimes(2);
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-source" },
      mocks.tx,
    );
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-destination" },
      mocks.tx,
    );
  });

  it("does not collapse a transfer retry onto an existing movement with only an overlapping source warehouse", async () => {
    const existingPartialTransfer = [{ id: "movement-existing", reference: "TR-43", warehouseId: "wh-source" }];
    const created = [
      { id: "movement-source", reference: "TR-43", warehouseId: "wh-source" },
      { id: "movement-destination", reference: "TR-43", warehouseId: "wh-other-destination" },
    ];
    mocks.selectRows.push(existingPartialTransfer);
    returning.mockResolvedValueOnce(created);

    const result = await registerStockMovementOperation({
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-source",
      destinationWarehouseId: "wh-other-destination",
      movementType: "TRANSFER",
      quantity: 4,
      movedAt,
      reason: "Rebalanceo distinto",
      reference: "TR-43",
    });

    expect(result).toEqual(created);
    expect(mocks.txInsert).toHaveBeenCalledTimes(1);
    expect(refreshStockLocation).toHaveBeenCalledTimes(2);
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-source" },
      mocks.tx,
    );
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-other-destination" },
      mocks.tx,
    );
  });

  it("records a physical count as a signed adjustment with audit reason/reference", async () => {
    await registerStockMovementOperation({
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-main",
      movementType: "ADJUSTMENT",
      quantity: -3,
      movedAt,
      reason: "Conteo físico: diferencia inventario",
      reference: "CNT-9",
    });

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        warehouseId: "wh-main",
        movementType: "ADJUSTMENT",
        quantity: "-3.000",
        reason: "Conteo físico: diferencia inventario",
        reference: "CNT-9",
      }),
    ]);
    expect(refreshStockLocation).toHaveBeenCalledWith(
      { companyId: "company-1", itemId: "item-1", warehouseId: "wh-main" },
      mocks.tx,
    );
  });
});
