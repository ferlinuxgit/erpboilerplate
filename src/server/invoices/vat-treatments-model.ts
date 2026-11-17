import { salesVatTreatmentOptions, type SalesVatTreatmentCode } from "@/server/invoices/lifecycle";

/**
 * Tratamientos de IVA que una empresa usa en sus ventas (código puro, también en el cliente).
 * Sin elección guardada se deducen de lo que vende: el nacional siempre; a la UE y fuera de ella,
 * los de productos y/o servicios; exenta si su régimen lo es. La inversión del sujeto pasivo
 * nacional (obras, chatarra) se activa a mano.
 */

const ALL = new Set<string>(salesVatTreatmentOptions.map((option) => option.value));

export function isSalesVatTreatmentCode(value: string): value is SalesVatTreatmentCode {
  return ALL.has(value);
}

export function defaultSalesVatTreatments({ businessType, salesExempt = false }: { businessType?: string | null; salesExempt?: boolean }): SalesVatTreatmentCode[] {
  const products = businessType !== "services";
  const services = businessType !== "products";
  return orderTreatments([
    "DOMESTIC",
    ...(salesExempt ? (["EXEMPT"] as const) : []),
    ...(products ? (["INTRA_EU", "EXPORT"] as const) : []),
    ...(services ? (["INTRA_EU_SERVICES", "NOT_SUBJECT"] as const) : []),
  ]);
}

/** En el orden del catálogo, sin repetidos ni códigos desconocidos y siempre con el nacional. */
export function orderTreatments(values: readonly string[]): SalesVatTreatmentCode[] {
  const wanted = new Set(["DOMESTIC", ...values.filter(isSalesVatTreatmentCode)]);
  return salesVatTreatmentOptions.map((option) => option.value).filter((value) => wanted.has(value));
}

/** Los que usa la empresa: su elección guardada o, si no hay, los automáticos. */
export function companySalesVatTreatments(saved: readonly string[] | null | undefined, context: { businessType?: string | null; salesExempt?: boolean }) {
  return saved && saved.length > 0 ? orderTreatments(saved) : defaultSalesVatTreatments(context);
}

/** Opciones del diálogo de la factura: las que usa la empresa y, si es otra, la elegida ahora. */
export function visibleVatTreatmentOptions(enabled: readonly string[] | undefined, current: string | null | undefined) {
  if (!enabled || enabled.length === 0) return salesVatTreatmentOptions;
  const shown = new Set([...enabled, ...(current ? [current] : [])]);
  return salesVatTreatmentOptions.filter((option) => shown.has(option.value));
}
