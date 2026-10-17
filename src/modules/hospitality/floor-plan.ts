/**
 * Plano de una sala: cuadrícula de celdas donde cada mesa ocupa un rectángulo (x, y, ancho, alto).
 * Las mesas sin posición se colocan solas en filas; el editor solo deja posiciones dentro de la sala.
 */

export const PLAN_COLS = 24;
export const PLAN_ROWS = 16;

export const TABLE_SHAPES = ["SQUARE", "ROUND", "RECT"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];
export const tableShapeLabels: Record<TableShape, string> = { SQUARE: "Cuadrada", ROUND: "Redonda", RECT: "Rectangular" };

export type PlanTable = { id: string; posX: number | null; posY: number | null; width: number; height: number };
export type PlacedTable<T extends PlanTable> = T & { posX: number; posY: number };

export function clampToPlan(table: { posX: number; posY: number; width: number; height: number }) {
  const width = Math.max(1, Math.min(PLAN_COLS, Math.round(table.width)));
  const height = Math.max(1, Math.min(PLAN_ROWS, Math.round(table.height)));
  return {
    width,
    height,
    posX: Math.max(0, Math.min(PLAN_COLS - width, Math.round(table.posX))),
    posY: Math.max(0, Math.min(PLAN_ROWS - height, Math.round(table.posY))),
  };
}

export function overlaps(a: { posX: number; posY: number; width: number; height: number }, b: { posX: number; posY: number; width: number; height: number }) {
  return a.posX < b.posX + b.width && b.posX < a.posX + a.width && a.posY < b.posY + b.height && b.posY < a.posY + a.height;
}

/** Primer hueco libre (por filas, con una celda de separación) para una mesa de ese tamaño. */
export function findFreeSpot(placed: ReadonlyArray<{ posX: number; posY: number; width: number; height: number }>, width: number, height: number) {
  for (let posY = 0; posY + height <= PLAN_ROWS; posY += 1) {
    for (let posX = 0; posX + width <= PLAN_COLS; posX += 1) {
      const candidate = { posX, posY, width: width + 1, height: height + 1 };
      if (!placed.some((other) => overlaps(candidate, { ...other, width: other.width + 1, height: other.height + 1 }))) return { posX, posY };
    }
  }
  return { posX: 0, posY: 0 };
}

/** Coloca las mesas que aún no tienen posición sin pisar las que ya la tienen. */
export function autoLayout<T extends PlanTable>(tables: readonly T[]): Array<PlacedTable<T>> {
  const placed: Array<PlacedTable<T>> = [];
  for (const table of tables) {
    if (table.posX !== null && table.posY !== null) placed.push({ ...table, ...clampToPlan({ ...table, posX: table.posX, posY: table.posY }) });
  }
  const result = [...placed];
  for (const table of tables) {
    if (table.posX !== null && table.posY !== null) continue;
    const spot = findFreeSpot(result, table.width, table.height);
    result.push({ ...table, posX: spot.posX, posY: spot.posY });
  }
  return tables.map((table) => result.find((entry) => entry.id === table.id)!);
}
