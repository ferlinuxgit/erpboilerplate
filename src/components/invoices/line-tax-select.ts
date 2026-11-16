import { formatPercent } from "@/lib/format";
import { findSurchargeTaxForVat } from "@/server/invoices/default-taxes";

/**
 * Impuestos de una línea de factura con dos selectores nativos: «IVA» (lo que suma: IVA, IVA con
 * recargo de equivalencia u otros impuestos) y «Retención» (lo que resta: IRPF, alquileres…).
 * Lo guardado no cambia: la línea sigue teniendo su lista de impuestos (`taxIds`).
 * Código puro, sin React, para poder probarlo aislado.
 */

export type LineTaxSelectOption = { id: string; name: string; rate: number; kind?: string; operation: "ADD" | "SUBTRACT"; isActive?: boolean };
export type TaxSelectChoice = { value: string; label: string };

const NONE = "";

/** Valor de un selector: los ids ordenados y unidos (vacío = ninguno). */
function valueOf(ids: readonly string[]) {
  return [...ids].sort().join(",");
}

/** «IVA» sin porcentaje en el nombre → «IVA 21 %»; «IVA general 21%» se deja tal cual. */
function taxLabel(tax: LineTaxSelectOption) {
  const rate = formatPercent(tax.rate).replace(/\s*%$/, "");
  const label = tax.name.includes(rate) ? tax.name : `${tax.name} ${formatPercent(tax.rate)}`;
  return tax.isActive === false ? `${label} (archivado)` : label;
}

function isSurcharge(tax: LineTaxSelectOption) {
  return (tax.kind ?? "").toUpperCase() === "SURCHARGE";
}

function choicesFor(taxes: readonly LineTaxSelectOption[], selected: readonly string[], operation: "ADD" | "SUBTRACT", noneLabel: string) {
  const own = taxes.filter((tax) => tax.operation === operation);
  // IVA de mayor a menor (el general, 21 %, arriba); retenciones de menor a mayor (7, 15, 19 %).
  const usable = own.filter((tax) => tax.isActive !== false).sort((left, right) => (operation === "ADD" ? right.rate - left.rate : left.rate - right.rate));
  const choices: TaxSelectChoice[] = [{ value: NONE, label: noneLabel }];
  for (const tax of usable) {
    if (isSurcharge(tax)) continue;
    choices.push({ value: valueOf([tax.id]), label: taxLabel(tax) });
    // IVA + recargo de equivalencia como una sola opción (clientes en recargo).
    if (operation === "ADD" && (tax.kind ?? "VAT").toUpperCase() === "VAT") {
      const surcharge = findSurchargeTaxForVat(usable.filter(isSurcharge), tax.rate);
      if (surcharge) choices.push({ value: valueOf([tax.id, surcharge.id]), label: `${taxLabel(tax)} + recargo ${formatPercent(surcharge.rate)}` });
    }
  }
  // Una combinación guardada que no está entre las opciones (p. ej. un impuesto archivado o dos a
  // la vez) se conserva como opción propia: abrir y guardar nunca cambia los impuestos sin querer.
  const current = valueOf(selected.filter((id) => own.some((tax) => tax.id === id)));
  if (current !== NONE && !choices.some((choice) => choice.value === current)) {
    const names = own.filter((tax) => current.split(",").includes(tax.id)).map(taxLabel);
    choices.push({ value: current, label: names.join(" + ") });
  }
  return { choices, value: current };
}

/** Opciones y valor actual de los dos selectores de una línea. */
export function lineTaxSelects(taxes: readonly LineTaxSelectOption[], selectedIds: readonly string[] = []) {
  return {
    added: choicesFor(taxes, selectedIds, "ADD", "Sin IVA"),
    withheld: choicesFor(taxes, selectedIds, "SUBTRACT", "Sin retención"),
    hasWithholding: taxes.some((tax) => tax.operation === "SUBTRACT"),
  };
}

/** Lista de impuestos de la línea a partir de lo elegido en los dos selectores. */
export function taxIdsFromSelects(addedValue: string, withheldValue: string) {
  return [...addedValue.split(","), ...withheldValue.split(",")].filter(Boolean);
}

/** Texto del botón de la línea: lo elegido en cada grupo («IVA 21 % · IRPF 15 %») o «Sin impuestos». */
export function lineTaxSummary(selects: ReturnType<typeof lineTaxSelects>) {
  const label = (group: { choices: TaxSelectChoice[]; value: string }) => (group.value ? group.choices.find((choice) => choice.value === group.value)?.label : undefined);
  const parts = [label(selects.added), label(selects.withheld)].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Sin impuestos";
}
