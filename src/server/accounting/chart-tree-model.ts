import type { AccountMonthlySeries, ChartAccountType, ChartFilters, ChartNature, ChartNode } from "@/lib/chart-of-accounts/types";
import { natureForAccountType } from "@/server/accounting/subaccounts-model";

/**
 * Reglas puras del árbol del plan contable: construcción de nodos con sus sumas por prefijo,
 * filtros (con movimientos, saldo distinto de cero, terceros, bloqueadas) y ancestros.
 */

export type ChartAccountRow = {
  id: string;
  code: string;
  name: string;
  type: ChartAccountType;
  nature: string | null;
  parentCode: string | null;
  isPostable: boolean;
  isBlocked: boolean;
  partnerId: string | null;
  partnerName: string | null;
  partnerTaxId: string | null;
};

export type PrefixTotals = { openingCents: number; debitCents: number; creditCents: number; entries: number };

const EMPTY_TOTALS: PrefixTotals = { openingCents: 0, debitCents: 0, creditCents: 0, entries: 0 };

export type ChartFilterContext = {
  /** Códigos de las cuentas bloqueadas (para mostrar los grupos que las contienen). */
  blockedCodes: readonly string[];
  /** Cuentas de terceros: 430 clientes, 400/410 proveedores y acreedores. */
  partnerPrefixes: readonly string[];
};

function isNature(value: string | null): value is ChartNature {
  return value === "DEBIT" || value === "CREDIT" || value === "MIXED";
}

export function buildChartNode(row: ChartAccountRow, totals: ReadonlyMap<string, PrefixTotals>, childCounts: ReadonlyMap<string, number>): ChartNode {
  const sums = totals.get(row.code) ?? EMPTY_TOTALS;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    nature: isNature(row.nature) ? row.nature : natureForAccountType(row.type),
    parentCode: row.parentCode,
    level: row.code.length,
    isPostable: row.isPostable,
    isBlocked: row.isBlocked,
    partnerId: row.partnerId,
    partnerName: row.partnerName,
    partnerTaxId: row.partnerTaxId,
    openingCents: sums.openingCents,
    debitCents: sums.debitCents,
    creditCents: sums.creditCents,
    balanceCents: sums.openingCents + sums.debitCents - sums.creditCents,
    entries: sums.entries,
    childCount: childCounts.get(row.code) ?? 0,
    hasMovements: sums.entries > 0 || sums.openingCents !== 0,
  };
}

/**
 * Un nodo pasa los filtros si él (o, para los grupos, alguna cuenta de su rama) cumple todos.
 * Los importes de los grupos ya son la suma de su rama, así que basta con mirar el propio nodo.
 */
export function nodePassesFilters(node: ChartNode, filters: ChartFilters, context: ChartFilterContext) {
  if (filters.movements && !node.hasMovements) return false;
  if (filters.nonzero && node.balanceCents === 0) return false;
  if (filters.partners && !context.partnerPrefixes.some((prefix) => node.code.startsWith(prefix) || prefix.startsWith(node.code))) return false;
  if (filters.blocked && !node.isBlocked && !context.blockedCodes.some((code) => code.length > node.code.length && code.startsWith(node.code))) return false;
  return true;
}

/** Prefijos estrictos existentes o no (1, 12, 123…) de varios códigos, sin repetir. */
export function ancestorPrefixes(codes: Iterable<string>): string[] {
  const prefixes = new Set<string>();
  for (const code of codes) {
    for (let size = 1; size < code.length; size += 1) prefixes.add(code.slice(0, size));
  }
  return [...prefixes];
}

/** Longitudes de código distintas (para agrupar las sumas por `left(code, n)`). */
export function distinctCodeLengths(codes: Iterable<string>): number[] {
  return [...new Set([...codes].map((code) => code.length))].sort((a, b) => a - b);
}

/**
 * Enlaza cada nodo con el antecesor más cercano presente en el conjunto (resultados de búsqueda:
 * la cadena de grupos se obtiene por prefijos y puede diferir de un `parentCode` antiguo).
 */
export function relinkToPresentAncestors(nodes: ChartNode[]): ChartNode[] {
  const present = new Set(nodes.map((node) => node.code));
  return nodes.map((node) => {
    let parentCode: string | null = null;
    for (let size = node.code.length - 1; size >= 1; size -= 1) {
      const prefix = node.code.slice(0, size);
      if (present.has(prefix)) {
        parentCode = prefix;
        break;
      }
    }
    return parentCode === node.parentCode ? node : { ...node, parentCode };
  });
}

/** Texto de búsqueda de NIF: sin espacios, guiones ni puntos y en mayúsculas. */
export function normalizeTaxIdQuery(value: string) {
  return value.replace(/[\s.\-]/g, "").toUpperCase();
}

/** Serie mensual (debe, haber y saldo acumulado a fin de mes) a partir de los netos por mes. */
export function buildMonthlySeries(
  label: string,
  keys: readonly string[],
  byMonth: ReadonlyMap<string, { debitCents: number; creditCents: number }>,
  openingCents: number,
): AccountMonthlySeries {
  let running = openingCents;
  const debitCents: number[] = [];
  const creditCents: number[] = [];
  const balanceCents: number[] = [];
  for (const key of keys) {
    const month = byMonth.get(key) ?? { debitCents: 0, creditCents: 0 };
    running += month.debitCents - month.creditCents;
    debitCents.push(month.debitCents);
    creditCents.push(month.creditCents);
    balanceCents.push(running);
  }
  return { label, debitCents, creditCents, balanceCents };
}
