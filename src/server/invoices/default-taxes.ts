/**
 * Impuestos propuestos por defecto en documentos de venta (código puro, también usable en cliente).
 *
 * IVA por defecto: el impuesto marcado como predeterminado que sea IVA repercutido (kind VAT,
 * operación ADD). Si no hay ninguno marcado, el IVA general del 21 %. Nunca "el de menor tipo".
 */

export const GENERAL_VAT_RATE = 21;

/** Recargo de equivalencia asociado a cada tipo de IVA (art. 161 LIVA). */
export const SURCHARGE_BY_VAT_RATE: Record<string, number> = { "21": 5.2, "10": 1.4, "5": 0.62, "4": 0.5 };

export type ConfiguredTaxLike = {
  id: string;
  rate: number | string;
  kind?: string | null;
  operation?: string | null;
  isDefault?: boolean | null;
  isActive?: boolean | null;
};

function rateOf(tax: ConfiguredTaxLike) {
  return Number(tax.rate);
}

function sameRate(left: number, right: number) {
  return Math.abs(left - right) < 0.0005;
}

function isUsable(tax: ConfiguredTaxLike) {
  return tax.isActive !== false;
}

export function isVatTax(tax: ConfiguredTaxLike) {
  return (tax.kind ?? "VAT").toUpperCase() === "VAT" && (tax.operation ?? "ADD").toUpperCase() === "ADD";
}

export function isWithholdingTax(tax: ConfiguredTaxLike) {
  return (tax.kind ?? "").toUpperCase() === "WITHHOLDING" || (tax.operation ?? "").toUpperCase() === "SUBTRACT";
}

/** IVA por defecto: el marcado como predeterminado (VAT + ADD, activo) o, si no hay, el del 21 %. */
export function pickDefaultVatTax<T extends ConfiguredTaxLike>(taxes: T[]): T | null {
  const vat = taxes.filter((tax) => isUsable(tax) && isVatTax(tax));
  return vat.find((tax) => tax.isDefault) ?? vat.find((tax) => sameRate(rateOf(tax), GENERAL_VAT_RATE)) ?? null;
}

/** Tipo de IVA por defecto (presupuestos y pedidos, que guardan el tipo y no el impuesto). */
export function defaultVatRate(taxes: ConfiguredTaxLike[]) {
  const selected = pickDefaultVatTax(taxes);
  return selected ? rateOf(selected) : GENERAL_VAT_RATE;
}

/** IVA repercutido activo con ese tipo (para convertir tipos guardados en impuestos configurados). */
export function findVatTaxByRate<T extends ConfiguredTaxLike>(taxes: T[], rate: number): T | null {
  const candidates = taxes.filter((tax) => isUsable(tax) && isVatTax(tax) && sameRate(rateOf(tax), rate));
  return candidates.find((tax) => tax.isDefault) ?? candidates[0] ?? null;
}

/** Retención (IRPF) activa con ese tipo. */
export function findRetentionTaxByRate<T extends ConfiguredTaxLike>(taxes: T[], rate: number | null | undefined): T | null {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate)) || Number(rate) <= 0) return null;
  return taxes.find((tax) => isUsable(tax) && (tax.kind ?? "").toUpperCase() === "WITHHOLDING" && sameRate(rateOf(tax), Number(rate))) ?? null;
}

/** Recargo de equivalencia activo que corresponde a un tipo de IVA. */
export function findSurchargeTaxForVat<T extends ConfiguredTaxLike>(taxes: T[], vatRate: number): T | null {
  const surchargeRate = SURCHARGE_BY_VAT_RATE[String(vatRate)];
  if (surchargeRate === undefined) return null;
  return taxes.find((tax) => isUsable(tax) && (tax.kind ?? "").toUpperCase() === "SURCHARGE" && sameRate(rateOf(tax), surchargeRate)) ?? null;
}

/**
 * Impuestos que se proponen en una línea nueva de factura: IVA por defecto, recargo si el cliente
 * está en recargo de equivalencia y la retención habitual del cliente (IRPF).
 */
export function defaultLineTaxIds(
  taxes: ConfiguredTaxLike[],
  customer?: { defaultRetentionRate?: number | string | null; equivalenceSurcharge?: boolean | null } | null,
  options: { withVat?: boolean } = {},
) {
  const ids: string[] = [];
  const vat = options.withVat === false ? null : pickDefaultVatTax(taxes);
  if (vat) {
    ids.push(vat.id);
    if (customer?.equivalenceSurcharge) {
      const surcharge = findSurchargeTaxForVat(taxes, rateOf(vat));
      if (surcharge) ids.push(surcharge.id);
    }
  }
  const retention = findRetentionTaxByRate(taxes, customer?.defaultRetentionRate === null || customer?.defaultRetentionRate === undefined ? null : Number(customer.defaultRetentionRate));
  if (retention) ids.push(retention.id);
  return ids;
}
