import { describe, expect, it } from "vitest";

import { buildStockMovementEntries, calculateStockQuantity } from "./movements";

describe("inventory stock movement effects", () => {
  it("adds receipts and signed adjustments to stock quantity", () => {
    const quantity = calculateStockQuantity([
      { movementType: "IN", quantity: "10.000", warehouseId: "wh-main" },
      { movementType: "ADJUSTMENT", quantity: "-2.000", warehouseId: "wh-main" },
      { movementType: "ADJUSTMENT", quantity: "1.500", warehouseId: "wh-main" },
    ]);

    expect(quantity).toBe(9.5);
  });

  it("creates balanced transfer entries so source decreases and destination increases", () => {
    const entries = buildStockMovementEntries({
      companyId: "company-1",
      itemId: "item-1",
      warehouseId: "wh-source",
      destinationWarehouseId: "wh-destination",
      movementType: "TRANSFER",
      quantity: 4,
      movedAt: new Date("2026-05-09T08:00:00.000Z"),
      reason: "Rebalance stock",
      reference: "TR-42",
    });

    expect(entries).toMatchObject([
      {
        companyId: "company-1",
        itemId: "item-1",
        warehouseId: "wh-source",
        movementType: "TRANSFER",
        quantity: "-4.000",
        reason: "Rebalance stock",
        reference: "TR-42",
      },
      {
        companyId: "company-1",
        itemId: "item-1",
        warehouseId: "wh-destination",
        movementType: "TRANSFER",
        quantity: "4.000",
        reason: "Rebalance stock",
        reference: "TR-42",
      },
    ]);
    expect(calculateStockQuantity(entries.filter((entry) => entry.warehouseId === "wh-source"))).toBe(-4);
    expect(calculateStockQuantity(entries.filter((entry) => entry.warehouseId === "wh-destination"))).toBe(4);
  });

  it("rejects stock operations without a reference for auditability", () => {
    expect(() =>
      buildStockMovementEntries({
        companyId: "company-1",
        itemId: "item-1",
        warehouseId: "wh-main",
        movementType: "IN",
        quantity: 3,
        movedAt: new Date("2026-05-09T08:00:00.000Z"),
        reason: "Supplier receipt",
      }),
    ).toThrow("referencia");
  });

  it("rejects transfers without a different destination warehouse", () => {
    expect(() =>
      buildStockMovementEntries({
        companyId: "company-1",
        itemId: "item-1",
        warehouseId: "wh-source",
        movementType: "TRANSFER",
        quantity: 4,
        movedAt: new Date("2026-05-09T08:00:00.000Z"),
        reason: "Missing destination",
        reference: "TR-MISSING",
      }),
    ).toThrow("almacén destino");

    expect(() =>
      buildStockMovementEntries({
        companyId: "company-1",
        itemId: "item-1",
        warehouseId: "wh-source",
        destinationWarehouseId: "wh-source",
        movementType: "TRANSFER",
        quantity: 4,
        movedAt: new Date("2026-05-09T08:00:00.000Z"),
        reason: "Same destination",
        reference: "TR-SAME",
      }),
    ).toThrow("diferente");
  });
});
