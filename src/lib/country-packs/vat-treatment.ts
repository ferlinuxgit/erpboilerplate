/**
 * Tratamiento del IVA de una operación deducido de los datos que ya existen (país de la empresa,
 * país y NIF del cliente o proveedor, qué vende la empresa). El usuario no elige nada: el
 * formulario lo propone y solo se cambia a mano en casos especiales.
 *
 * Reglas (Directiva 2006/112/CE; en España, Ley 37/1992 del IVA):
 * - Mismo país → nacional.
 * - Empresa y cliente en países distintos de la UE:
 *   · cliente con NIF-IVA (empresa) → entrega intracomunitaria exenta (bienes) o servicio con
 *     inversión del sujeto pasivo (servicios);
 *   · cliente sin NIF-IVA (consumidor final) → IVA del país de la empresa (venta a distancia por
 *     debajo del umbral de 10.000 €; por encima se declara en la OSS).
 * - Cliente fuera de la UE (o empresa fuera de la UE y cliente en otro país):
 *   · bienes → exportación exenta;
 *   · servicios a empresa (con identificador fiscal) → no sujeta por reglas de localización;
 *   · servicios a consumidor final → IVA del país de la empresa.
 * - Compras: proveedor de otro país de la UE → adquisición intracomunitaria (autorepercusión);
 *   proveedor de fuera → servicios con inversión del sujeto pasivo, bienes como importación (el
 *   IVA se liquida en aduana).
 */

import { isEuCountry, normalizeCountryCode } from "@/lib/countries";

export type SalesVatTreatment = "DOMESTIC" | "INTRA_EU" | "INTRA_EU_SERVICES" | "EXPORT" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_SUBJECT";
export type SupplierVatTreatment = "DOMESTIC" | "INTRA_EU" | "REVERSE_CHARGE" | "IMPORT" | "NOT_SUBJECT";

export type VatTreatmentContext = {
  /** País de la empresa que factura (por defecto, España). */
  homeCountry?: string | null;
  /** Qué vende la empresa: "products", "services" o "both" (ajustes de empresa). */
  businessType?: string | null;
};

export function normalizeHomeCountry(value: string | null | undefined) {
  return normalizeCountryCode(value) || "ES";
}

/** País de la contraparte; vacío = mismo país que la empresa. */
function counterpartyCountry(value: string | null | undefined, home: string) {
  return normalizeCountryCode(value) || home;
}

function hasTaxId(value: string | null | undefined) {
  return Boolean(value?.replace(/[\s.-]/g, ""));
}

/** ¿Operación entre dos países distintos de la UE? */
export function isIntraCommunity(homeCountry: string | null | undefined, otherCountry: string | null | undefined) {
  const home = normalizeHomeCountry(homeCountry);
  const other = counterpartyCountry(otherCountry, home);
  return other !== home && isEuCountry(home) && isEuCountry(other);
}

export function suggestSalesVatTreatment(
  customer: { countryCode?: string | null; taxId?: string | null } | null | undefined,
  context: VatTreatmentContext = {},
): SalesVatTreatment {
  const home = normalizeHomeCountry(context.homeCountry);
  const country = counterpartyCountry(customer?.countryCode, home);
  if (country === home) return "DOMESTIC";
  const services = context.businessType === "services";
  const business = hasTaxId(customer?.taxId);
  if (isEuCountry(home) && isEuCountry(country)) {
    if (!business) return "DOMESTIC";
    return services ? "INTRA_EU_SERVICES" : "INTRA_EU";
  }
  if (!services) return "EXPORT";
  return business ? "NOT_SUBJECT" : "DOMESTIC";
}

export function suggestSupplierVatTreatment(
  supplier: { countryCode?: string | null; supplierKind?: string | null } | null | undefined,
  context: VatTreatmentContext = {},
): SupplierVatTreatment {
  const home = normalizeHomeCountry(context.homeCountry);
  const country = counterpartyCountry(supplier?.countryCode, home);
  if (country === home) return "DOMESTIC";
  if (isEuCountry(home) && isEuCountry(country)) return "INTRA_EU";
  return supplier?.supplierKind === "SERVICES" ? "REVERSE_CHARGE" : "IMPORT";
}
