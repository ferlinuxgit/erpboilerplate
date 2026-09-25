/**
 * Hoja de recuento de inventario: a partir del stock que dice el sistema y de lo contado
 * físicamente calcula los ajustes necesarios. Módulo puro (cliente y servidor).
 */

import { parseDecimalInput } from "@/lib/format";

const EPSILON = 0.0005;

export type CountSheetRow = {
  itemId: string;
  systemQuantity: number;
  /** Lo que el usuario escribió; vacío = artículo no contado (no se ajusta). */
  countedRaw: string;
};

export type CountDifference = {
  itemId: string;
  systemQuantity: number;
  countedQuantity: number;
  /** Ajuste a registrar: contado − sistema (positivo suma stock, negativo lo resta). */
  difference: number;
};

export function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function computeCountDifferences(rows: readonly CountSheetRow[]) {
  const counted: CountDifference[] = [];
  const errors: Record<string, string> = {};
  for (const row of rows) {
    if (!row.countedRaw.trim()) continue;
    const countedQuantity = parseDecimalInput(row.countedRaw);
    if (countedQuantity === null) {
      errors[row.itemId] = "Cantidad no válida (p. ej. 12 o 7,5).";
      continue;
    }
    if (countedQuantity < 0) {
      errors[row.itemId] = "Lo contado no puede ser negativo.";
      continue;
    }
    const rounded = roundQuantity(countedQuantity);
    counted.push({ itemId: row.itemId, systemQuantity: row.systemQuantity, countedQuantity: rounded, difference: roundQuantity(rounded - row.systemQuantity) });
  }
  const adjustments = counted.filter((entry) => Math.abs(entry.difference) > EPSILON);
  return {
    counted,
    adjustments,
    errors,
    summary: {
      countedItems: counted.length,
      adjustments: adjustments.length,
      unitsIn: roundQuantity(adjustments.filter((entry) => entry.difference > 0).reduce((total, entry) => total + entry.difference, 0)),
      unitsOut: roundQuantity(adjustments.filter((entry) => entry.difference < 0).reduce((total, entry) => total - entry.difference, 0)),
    },
  };
}

/** Artículos cuyo stock cambió entre que se abrió la hoja y se registró el recuento. */
export function findStaleCountLines(
  lines: ReadonlyArray<{ itemId: string; expectedQuantity: number }>,
  currentByItem: ReadonlyMap<string, number>,
) {
  return lines.filter((line) => Math.abs((currentByItem.get(line.itemId) ?? 0) - line.expectedQuantity) > EPSILON).map((line) => line.itemId);
}
