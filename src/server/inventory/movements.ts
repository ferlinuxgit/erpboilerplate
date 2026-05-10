export type StockMovementType = "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";

export type StockMovementEffect = {
  movementType: StockMovementType;
  quantity: string | number;
  warehouseId?: string | null;
};

export type StockMovementOperationInput = {
  companyId: string;
  itemId: string;
  warehouseId: string;
  destinationWarehouseId?: string | null;
  movementType: StockMovementType;
  quantity: number;
  movedAt: Date;
  reason: string;
  reference?: string | null;
};

export type StockMovementEntry = {
  companyId: string;
  itemId: string;
  warehouseId: string;
  movementType: StockMovementType;
  quantity: string;
  movedAt: Date;
  reason: string;
  reference: string | null;
};

function toNumber(quantity: string | number) {
  const value = typeof quantity === "number" ? quantity : Number(quantity);
  return Number.isFinite(value) ? value : 0;
}

export function calculateStockQuantity(movements: StockMovementEffect[]) {
  return movements.reduce((total, movement) => {
    const quantity = toNumber(movement.quantity);

    if (movement.movementType === "OUT") return total - Math.abs(quantity);
    if (movement.movementType === "TRANSFER") return total + quantity;
    return total + quantity;
  }, 0);
}

function formatQuantity(quantity: number) {
  return quantity.toFixed(3);
}

export function buildStockMovementEntries(input: StockMovementOperationInput): StockMovementEntry[] {
  const reason = input.reason.trim();
  const reference = input.reference?.trim() ? input.reference.trim() : null;

  if (!reason) throw new Error("La razón del movimiento es obligatoria.");
  if (!reference) throw new Error("La referencia del movimiento es obligatoria.");
  if (!Number.isFinite(input.quantity) || input.quantity === 0) throw new Error("La cantidad debe ser distinta de cero.");

  if (input.movementType === "TRANSFER") {
    if (!input.destinationWarehouseId) throw new Error("El almacén destino es obligatorio para una transferencia.");
    if (input.destinationWarehouseId === input.warehouseId) throw new Error("El almacén destino debe ser diferente del origen.");
    if (input.quantity <= 0) throw new Error("La cantidad de una transferencia debe ser positiva.");

    const base = {
      companyId: input.companyId,
      itemId: input.itemId,
      movementType: "TRANSFER" as const,
      movedAt: input.movedAt,
      reason,
      reference,
    };

    return [
      { ...base, warehouseId: input.warehouseId, quantity: formatQuantity(-input.quantity) },
      { ...base, warehouseId: input.destinationWarehouseId, quantity: formatQuantity(input.quantity) },
    ];
  }

  if (input.destinationWarehouseId) throw new Error("El almacén destino solo se usa en transferencias.");
  if (input.movementType === "IN" && input.quantity <= 0) throw new Error("La cantidad de una recepción debe ser positiva.");
  if (input.movementType === "OUT" && input.quantity <= 0) throw new Error("La cantidad de una salida debe ser positiva.");

  return [
    {
      companyId: input.companyId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      movementType: input.movementType,
      quantity: formatQuantity(input.movementType === "OUT" ? Math.abs(input.quantity) : input.quantity),
      movedAt: input.movedAt,
      reason,
      reference,
    },
  ];
}
