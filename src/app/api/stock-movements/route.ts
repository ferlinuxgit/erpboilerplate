import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { item, stockMovement, warehouse } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, HttpError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { type StockMovementType } from "@/server/inventory/movements";
import { registerStockMovementOperation } from "@/server/inventory/stock-movement-service";

const movementTypes: StockMovementType[] = ["IN", "OUT", "ADJUSTMENT", "TRANSFER"];

// Errores de validación de dominio de `server/inventory` (mensajes pensados para el usuario).
// Cualquier otro error (p. ej. de base de datos) se registra y se responde con un mensaje genérico.
const DOMAIN_ERROR_PATTERN = /^(Stock insuficiente|La razón del movimiento|La referencia del movimiento|La cantidad|El almacén destino)/;

export async function GET(request: Request) {
  try {
    return await listStockMovements(request);
  } catch (error) {
    return handleRouteError(error, "stockMovement.list");
  }
}

export async function POST(request: Request) {
  try {
    return await createStockMovement(request);
  } catch (error) {
    if (error instanceof Error && !(error instanceof HttpError) && DOMAIN_ERROR_PATTERN.test(error.message)) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return handleRouteError(error, "stockMovement.create", "No se pudo registrar el movimiento.");
  }
}

async function listStockMovements(request: Request) {
  const { ctx } = await requirePermission("stock.read");
  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const warehouseId = url.searchParams.get("warehouseId");
  const movementType = url.searchParams.get("movementType") as StockMovementType | null;

  const filters = [eq(stockMovement.companyId, ctx.company.id)];
  if (itemId) filters.push(eq(stockMovement.itemId, itemId));
  if (warehouseId) filters.push(eq(stockMovement.warehouseId, warehouseId));
  if (movementType && movementTypes.includes(movementType)) filters.push(eq(stockMovement.movementType, movementType));

  const rows = await db
    .select({
      id: stockMovement.id,
      itemId: stockMovement.itemId,
      itemName: item.name,
      itemSku: item.sku,
      warehouseId: stockMovement.warehouseId,
      warehouseName: warehouse.name,
      warehouseCode: warehouse.code,
      movementType: stockMovement.movementType,
      quantity: stockMovement.quantity,
      movedAt: stockMovement.movedAt,
      reason: stockMovement.reason,
      reference: stockMovement.reference,
    })
    .from(stockMovement)
    .innerJoin(item, and(eq(item.id, stockMovement.itemId), eq(item.companyId, ctx.company.id)))
    .innerJoin(warehouse, and(eq(warehouse.id, stockMovement.warehouseId), eq(warehouse.companyId, ctx.company.id)))
    .where(and(...filters))
    .orderBy(desc(stockMovement.movedAt));

  return NextResponse.json(rows);
}

async function createStockMovement(request: Request) {
  const { ctx, user } = await requirePermission("stock.write", "Sin permisos para mover stock.");

  const payload = (await readJsonBody(request)) as {
    itemId?: string;
    warehouseId?: string;
    destinationWarehouseId?: string;
    movementType?: StockMovementType;
    quantity?: string | number;
    movedAt?: string;
    reason?: string;
    reference?: string;
  } | null;
  if (!payload) return invalidJsonResponse();

  if (
    !payload.itemId ||
    !payload.warehouseId ||
    !payload.movementType ||
    payload.quantity === undefined ||
    !payload.movedAt ||
    !payload.reason?.trim() ||
    !payload.reference?.trim()
  ) {
    return NextResponse.json({ message: "Item, almacén, tipo, cantidad, fecha, motivo y referencia son obligatorios." }, { status: 400 });
  }
  if (!movementTypes.includes(payload.movementType)) return NextResponse.json({ message: "Tipo de movimiento inválido." }, { status: 400 });

  const quantityNumber = Number(payload.quantity);
  const movedAt = new Date(payload.movedAt);
  if (!Number.isFinite(quantityNumber) || quantityNumber === 0) {
    return NextResponse.json({ message: "La cantidad debe ser un número distinto de cero." }, { status: 400 });
  }
  if (Number.isNaN(movedAt.getTime())) return NextResponse.json({ message: "Fecha de movimiento inválida." }, { status: 400 });

  const warehouseIds = [payload.warehouseId, payload.destinationWarehouseId].filter(Boolean) as string[];
  const [ownedItem, ownedWarehouses] = await Promise.all([
    db.select({ id: item.id }).from(item).where(and(eq(item.id, payload.itemId), eq(item.companyId, ctx.company.id), eq(item.isActive, true))).limit(1),
    db.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.companyId, ctx.company.id), eq(warehouse.isActive, true), inArray(warehouse.id, warehouseIds))),
  ]);
  if (!ownedItem[0] || ownedWarehouses.length !== new Set(warehouseIds).size) return NextResponse.json({ message: "Item o almacén inválido." }, { status: 404 });

  const created = await registerStockMovementOperation({
    companyId: ctx.company.id,
    itemId: payload.itemId,
    warehouseId: payload.warehouseId,
    destinationWarehouseId: payload.destinationWarehouseId,
    movementType: payload.movementType,
    quantity: quantityNumber,
    movedAt,
    reason: payload.reason,
    reference: payload.reference,
  }, { tenantId: ctx.tenant.id, actorUserId: user.id });

  return NextResponse.json(created, { status: 201 });
}
