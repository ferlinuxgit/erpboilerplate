import type { ResourceListExportColumn } from "@/components/ui/resource-list";

type Amount = number | string | null | undefined;

function toNumber(value: Amount) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

/**
 * Columnas de importes de una factura para la exportación de los listados: Base, IVA, IRPF y Total.
 * Son opcionales (se marcan o desmarcan en el menú de exportar) y van como números en el Excel.
 */
export function invoiceAmountExportColumns<TItem>(pick: {
  base: (item: TItem) => Amount;
  tax: (item: TItem) => Amount;
  retention: (item: TItem) => Amount;
  total: (item: TItem) => Amount;
}): ResourceListExportColumn<TItem>[] {
  return [
    { header: "Base", optional: true, exportValue: (item) => toNumber(pick.base(item)) },
    { header: "IVA", optional: true, exportValue: (item) => toNumber(pick.tax(item)) },
    { header: "IRPF", optional: true, exportValue: (item) => toNumber(pick.retention(item)) },
    { header: "Total", optional: true, exportValue: (item) => toNumber(pick.total(item)) },
  ];
}
