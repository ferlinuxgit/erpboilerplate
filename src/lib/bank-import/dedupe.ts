import type { ImportedMovement, SkippedRow } from "@/lib/bank-import/types";

export type ExistingMovement = { postedAt: Date; amount: string | number; description: string; balanceAfter?: string | number | null };

function baseKey(postedAt: Date, amount: string | number, description: string) {
  return `${postedAt.getTime()}|${Number(amount).toFixed(2)}|${description.replace(/\s+/g, " ").trim().toLocaleLowerCase("es-ES")}`;
}

function balanceKey(balance: string | number) {
  return Number(balance).toFixed(2);
}

/**
 * Decide qué filas importar sin perder cargos legítimos idénticos del mismo día:
 *
 * - Si el extracto trae saldo, el saldo tras el movimiento distingue dos cargos iguales: solo es
 *   duplicado si ya existe un movimiento con la misma fecha, importe, concepto y saldo.
 * - Sin saldo, se cuentan ocurrencias: si el fichero trae 3 cargos idénticos y ya hay 1 guardado
 *   (p. ej. de una importación anterior que se solapa), se importan los 2 que faltan.
 */
export function planImport(existing: ExistingMovement[], incoming: ImportedMovement[]) {
  const baseCounts = new Map<string, number>();
  const balanceCounts = new Map<string, Map<string, number>>();
  for (const row of existing) {
    const key = baseKey(row.postedAt, row.amount, row.description);
    baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1);
    if (row.balanceAfter !== null && row.balanceAfter !== undefined) {
      const balances = balanceCounts.get(key) ?? new Map<string, number>();
      const balance = balanceKey(row.balanceAfter);
      balances.set(balance, (balances.get(balance) ?? 0) + 1);
      balanceCounts.set(key, balances);
    }
  }

  const toInsert: ImportedMovement[] = [];
  const duplicates: SkippedRow[] = [];
  for (const movement of incoming) {
    const key = baseKey(movement.postedAt, movement.amount, movement.description);
    const balances = balanceCounts.get(key);
    let duplicate = false;
    if (movement.balanceAfter !== null && balances && balances.size > 0) {
      const balance = balanceKey(movement.balanceAfter);
      const remaining = balances.get(balance) ?? 0;
      if (remaining > 0) {
        balances.set(balance, remaining - 1);
        baseCounts.set(key, Math.max((baseCounts.get(key) ?? 1) - 1, 0));
        duplicate = true;
      }
    } else {
      const remaining = baseCounts.get(key) ?? 0;
      if (remaining > 0) {
        baseCounts.set(key, remaining - 1);
        duplicate = true;
      }
    }
    if (duplicate) duplicates.push({ line: movement.line, reason: "Ya estaba importado (misma fecha, importe y concepto)." });
    else toInsert.push(movement);
  }
  return { toInsert, duplicates };
}
