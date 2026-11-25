/**
 * Precios de venta por cliente (funciones puras, válidas en cliente y servidor).
 *
 * - Tarifa: la propia del cliente y, si no tiene, la de su grupo. Un artículo con precio propio en la
 *   tarifa usa ese precio; si no, su precio de venta con el ajuste de la tarifa (−10 = 10 % menos).
 * - Descuento: el del grupo del cliente, como descuento de línea (aparece en la factura).
 * - Sin tarifa ni grupo: el precio de venta del artículo, sin descuento.
 */
export type CustomerPricing = {
  priceList: { id: string; name: string; adjustmentPct: number; prices: Record<string, number> } | null;
  group: { id: string; name: string; discountPct: number } | null;
};

/** Artículo que se puede elegir en una línea de venta (precio de venta sin impuestos). */
export type SaleCatalogEntry = { id: string; sku: string; name: string; salePrice: number };

export type PriceSource = "list" | "adjusted" | "base";

export type ResolvedLinePrice = { unitPrice: number; discountPct: number; source: PriceSource };

export const NO_CUSTOMER_PRICING: CustomerPricing = { priceList: null, group: null };

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function resolveLinePrice(item: { id: string; salePrice: number }, pricing: CustomerPricing = NO_CUSTOMER_PRICING): ResolvedLinePrice {
  const discountPct = pricing.group?.discountPct ?? 0;
  const list = pricing.priceList;
  const listed = list?.prices[item.id];
  if (list && listed !== undefined) return { unitPrice: round2(listed), discountPct, source: "list" };
  if (list && list.adjustmentPct !== 0) {
    return { unitPrice: Math.max(0, round2(item.salePrice * (1 + list.adjustmentPct / 100))), discountPct, source: "adjusted" };
  }
  return { unitPrice: round2(item.salePrice), discountPct, source: "base" };
}

/** Texto corto para explicar al usuario de dónde salen los precios del cliente. */
export function describeCustomerPricing(pricing: CustomerPricing) {
  const parts: string[] = [];
  if (pricing.priceList) parts.push(`tarifa «${pricing.priceList.name}»`);
  if (pricing.group && pricing.group.discountPct > 0) {
    parts.push(`${String(pricing.group.discountPct).replace(".", ",")} % de descuento del grupo «${pricing.group.name}»`);
  }
  return parts.length ? `Precios con ${parts.join(" y ")}.` : null;
}
