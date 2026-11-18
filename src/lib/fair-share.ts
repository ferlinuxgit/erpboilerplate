/**
 * Reparto justo de trabajo entre clientes (procesos en segundo plano): nadie acapara una pasada.
 */

/** Hasta `perGroup` elementos de cada grupo, alternando entre grupos, y `total` como máximo. */
export function fairShare<T>(items: readonly T[], groupOf: (item: T) => string, perGroup: number, total: number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(groupOf(item)) ?? [];
    if (list.length < perGroup) list.push(item);
    groups.set(groupOf(item), list);
  }
  const result: T[] = [];
  for (let round = 0; result.length < total; round += 1) {
    let added = false;
    for (const list of groups.values()) {
      if (round < list.length && result.length < total) {
        result.push(list[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return result;
}
