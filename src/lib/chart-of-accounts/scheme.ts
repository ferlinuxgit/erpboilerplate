import type { ChartNode } from "@/lib/chart-of-accounts/types";

/**
 * Vista «Esquema»: una tarjeta por grupo del PGC (1–9) con sus subgrupos (2 dígitos) y barras
 * proporcionales al saldo, más el resultado 7 − 6. Funciones puras.
 */

export const PGC_GROUP_NAMES: Record<string, string> = {
  "1": "Financiación básica",
  "2": "Activo no corriente",
  "3": "Existencias",
  "4": "Acreedores y deudores",
  "5": "Cuentas financieras",
  "6": "Compras y gastos",
  "7": "Ventas e ingresos",
  "8": "Gastos imputados al patrimonio neto",
  "9": "Ingresos imputados al patrimonio neto",
};

export type SchemeSubgroup = {
  id: string;
  code: string;
  name: string;
  balanceCents: number;
  /** Proporción de la barra (0–1) respecto al mayor saldo absoluto del grupo. */
  share: number;
  hasMovements: boolean;
};

export type SchemeGroup = {
  code: string;
  name: string;
  id: string | null;
  balanceCents: number;
  hasMovements: boolean;
  subgroups: SchemeSubgroup[];
};

/** Anchura mínima visible de una barra con importe (para que un saldo pequeño no desaparezca). */
export const MIN_VISIBLE_SHARE = 0.02;

/** Proporciones de barra por valor absoluto: el mayor ocupa el 100 %; cero, nada. */
export function barShares(values: readonly number[]): number[] {
  const max = Math.max(0, ...values.map((value) => Math.abs(value)));
  if (max === 0) return values.map(() => 0);
  return values.map((value) => (value === 0 ? 0 : Math.max(MIN_VISIBLE_SHARE, Math.abs(value) / max)));
}

export function buildSchemeGroups(nodes: readonly ChartNode[]): SchemeGroup[] {
  const byCode = new Map(nodes.map((node) => [node.code, node]));
  return Object.keys(PGC_GROUP_NAMES).map((code) => {
    const group = byCode.get(code);
    const children = nodes.filter((node) => node.code.length === 2 && node.code.startsWith(code));
    const shares = barShares(children.map((child) => child.balanceCents));
    return {
      code,
      name: group?.name ?? PGC_GROUP_NAMES[code],
      id: group?.id ?? null,
      balanceCents: group?.balanceCents ?? 0,
      hasMovements: group?.hasMovements ?? false,
      subgroups: children.map((child, index) => ({
        id: child.id,
        code: child.code,
        name: child.name,
        balanceCents: child.balanceCents,
        share: shares[index],
        hasMovements: child.hasMovements,
      })),
    };
  });
}

/** Resultado = ingresos (saldo acreedor del grupo 7) − gastos (saldo deudor del grupo 6). */
export function schemeResult(groups: readonly SchemeGroup[]) {
  const revenueCents = -(groups.find((group) => group.code === "7")?.balanceCents ?? 0);
  const expenseCents = groups.find((group) => group.code === "6")?.balanceCents ?? 0;
  return { revenueCents, expenseCents, resultCents: revenueCents - expenseCents };
}
