/**
 * Territorio fiscal: el país o, dentro de España, la zona con impuesto indirecto propio.
 *
 * Canarias, Ceuta y Melilla son España (NIF, IRPF, Impuesto sobre Sociedades, VERI*FACTU y los
 * modelos 111, 115, 130 y 347 son los mismos) pero están fuera del territorio de aplicación del
 * IVA (art. 3 Ley 37/1992) y de la Unión aduanera a efectos del IVA:
 * - Canarias (ES-CN): IGIC (Ley 20/1991), gestionado por la Agencia Tributaria Canaria.
 * - Ceuta (ES-CE) y Melilla (ES-ML): IPSI (Ley 8/1991), gestionado por cada ciudad.
 * Entre esos territorios y la península (o el resto de la UE) las ventas de bienes son
 * exportaciones / importaciones y los servicios siguen las reglas de localización, igual que con
 * un país de fuera de la UE.
 *
 * El código de territorio es el código ISO 3166-1 del país o, para esas zonas, su código ISO
 * 3166-2 (ES-CN, ES-CE, ES-ML). Todo lo que acepta un código de país acepta también uno de
 * territorio.
 */

import { normalizeCountryCode } from "@/lib/countries";

export const SPANISH_SPECIAL_TERRITORIES = ["ES-CN", "ES-CE", "ES-ML"] as const;
export type SpanishSpecialTerritory = (typeof SPANISH_SPECIAL_TERRITORIES)[number];

export const spanishTerritoryNames: Record<SpanishSpecialTerritory, string> = {
  "ES-CN": "Canarias",
  "ES-CE": "Ceuta",
  "ES-ML": "Melilla",
};

/** Provincias (normalizadas) de cada territorio especial. */
const provinceTerritory: Record<string, SpanishSpecialTerritory> = {
  "las palmas": "ES-CN",
  "palmas": "ES-CN",
  "santa cruz de tenerife": "ES-CN",
  "s/c de tenerife": "ES-CN",
  "sc de tenerife": "ES-CN",
  "tenerife": "ES-CN",
  "gran canaria": "ES-CN",
  "lanzarote": "ES-CN",
  "fuerteventura": "ES-CN",
  "la palma": "ES-CN",
  "la gomera": "ES-CN",
  "el hierro": "ES-CN",
  "canarias": "ES-CN",
  "islas canarias": "ES-CN",
  "ceuta": "ES-CE",
  "melilla": "ES-ML",
};

/** Prefijo del código postal español de cada territorio especial. */
const postalTerritory: Record<string, SpanishSpecialTerritory> = {
  "35": "ES-CN",
  "38": "ES-CN",
  "51": "ES-CE",
  "52": "ES-ML",
};

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isSpanishSpecialTerritory(value: string | null | undefined): value is SpanishSpecialTerritory {
  return (SPANISH_SPECIAL_TERRITORIES as readonly string[]).includes((value ?? "").trim().toUpperCase());
}

/** Territorio especial español de una dirección (por código postal o, si falta, provincia). */
export function spanishTerritoryOf(address: { postalCode?: string | null; province?: string | null }): SpanishSpecialTerritory | null {
  const postal = (address.postalCode ?? "").replace(/\s/g, "");
  if (/^\d{5}$/.test(postal)) return postalTerritory[postal.slice(0, 2)] ?? null;
  return provinceTerritory[normalizeName(address.province)] ?? null;
}

/**
 * Territorio fiscal de una empresa, cliente o proveedor. `countryCode` puede venir ya como código
 * de territorio (ES-CN). Sin país: null (el llamador decide, normalmente "mismo que la empresa").
 */
export function taxTerritoryOf(party: { countryCode?: string | null; postalCode?: string | null; province?: string | null } | null | undefined): string | null {
  const raw = (party?.countryCode ?? "").trim().toUpperCase();
  if (isSpanishSpecialTerritory(raw)) return raw;
  const country = normalizeCountryCode(raw);
  if (!country) return null;
  if (country !== "ES") return country;
  return spanishTerritoryOf(party ?? {}) ?? "ES";
}

/** País de un código de territorio (ES-CN → ES). */
export function territoryCountry(territory: string | null | undefined) {
  const code = (territory ?? "").trim().toUpperCase();
  return isSpanishSpecialTerritory(code) ? "ES" : normalizeCountryCode(code);
}
