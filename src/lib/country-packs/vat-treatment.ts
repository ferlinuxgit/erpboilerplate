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
 * - Canarias, Ceuta y Melilla son territorios fiscales propios (IGIC / IPSI, fuera del IVA y del
 *   espacio IVA de la UE): entre ellos, la península y el resto de países se aplican las mismas
 *   reglas que con un país de fuera de la UE (art. 21 y 69 Ley 37/1992; arts. 11 y 17 Ley 20/1991).
 *   El territorio se deduce del código postal o la provincia (ver `territory.ts`).
 */

import { isEuCountry, normalizeCountryCode } from "@/lib/countries";
import { isSpanishSpecialTerritory, taxTerritoryOf } from "@/lib/country-packs/territory";

export type SalesVatTreatment = "DOMESTIC" | "INTRA_EU" | "INTRA_EU_SERVICES" | "EXPORT" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_SUBJECT";
export type SupplierVatTreatment = "DOMESTIC" | "INTRA_EU" | "REVERSE_CHARGE" | "IMPORT" | "NOT_SUBJECT";

export type VatTreatmentContext = {
  /** País o territorio fiscal de la empresa (ES, ES-CN…; por defecto, España peninsular). */
  homeCountry?: string | null;
  /** Qué vende la empresa: "products", "services" o "both" (ajustes de empresa). */
  businessType?: string | null;
  /**
   * Ventas interiores exentas por el régimen de la empresa (IGIC: comerciante minorista o
   * pequeño empresario): lo que sería "nacional" pasa a "exenta".
   */
  salesExempt?: boolean | null;
};

/** Territorio fiscal de la empresa: país o ES-CN / ES-CE / ES-ML. */
export function normalizeHomeCountry(value: string | null | undefined) {
  const raw = (value ?? "").trim().toUpperCase();
  if (isSpanishSpecialTerritory(raw)) return raw;
  return normalizeCountryCode(value) || "ES";
}

type Counterparty = { countryCode?: string | null; postalCode?: string | null; province?: string | null };

/** Territorio de la contraparte; sin país = mismo territorio que la empresa. */
function counterpartyTerritory(party: Counterparty | null | undefined, home: string) {
  if (!normalizeCountryCode(party?.countryCode) && !isSpanishSpecialTerritory(party?.countryCode)) return home;
  return taxTerritoryOf(party) ?? home;
}

function hasTaxId(value: string | null | undefined) {
  return Boolean(value?.replace(/[\s.-]/g, ""));
}

/** ¿Operación entre dos países distintos de la UE? */
export function isIntraCommunity(homeCountry: string | null | undefined, otherCountry: string | null | undefined) {
  const home = normalizeHomeCountry(homeCountry);
  const other = counterpartyTerritory({ countryCode: otherCountry }, home);
  return other !== home && isEuCountry(home) && isEuCountry(other);
}

export function suggestSalesVatTreatment(
  customer: (Counterparty & { taxId?: string | null }) | null | undefined,
  context: VatTreatmentContext = {},
): SalesVatTreatment {
  const home = normalizeHomeCountry(context.homeCountry);
  const country = counterpartyTerritory(customer, home);
  if (country === home) return context.salesExempt ? "EXEMPT" : "DOMESTIC";
  const services = context.businessType === "services";
  const business = hasTaxId(customer?.taxId);
  if (isEuCountry(home) && isEuCountry(country)) {
    if (!business) return "DOMESTIC";
    return services ? "INTRA_EU_SERVICES" : "INTRA_EU";
  }
  if (!services) return "EXPORT";
  if (business) return "NOT_SUBJECT";
  return context.salesExempt ? "EXEMPT" : "DOMESTIC";
}

export function suggestSupplierVatTreatment(
  supplier: (Counterparty & { supplierKind?: string | null }) | null | undefined,
  context: VatTreatmentContext = {},
): SupplierVatTreatment {
  const home = normalizeHomeCountry(context.homeCountry);
  const country = counterpartyTerritory(supplier, home);
  if (country === home) return "DOMESTIC";
  if (isEuCountry(home) && isEuCountry(country)) return "INTRA_EU";
  return supplier?.supplierKind === "SERVICES" ? "REVERSE_CHARGE" : "IMPORT";
}
