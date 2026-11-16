/**
 * Identificador fiscal de la empresa según su país: validación, normalización y lo que se puede
 * deducir de él (país y tipo de contribuyente) para no preguntárselo al usuario.
 */

import { isCountryCode, isEuCountry, normalizeCountryCode } from "@/lib/countries";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { describeSpanishTaxIdProblem, hasSpanishTaxIdFormat, normalizeSpanishTaxId } from "@/lib/spanish-tax-id";

export function normalizeTaxIdForCountry(value: string | null | undefined, countryCode: string | null | undefined) {
  if (getCountryFiscalProfile(countryCode).features.nationalTaxIdValidation === "es") return normalizeSpanishTaxId(value);
  return (value ?? "").toUpperCase().replace(/[\s.]/g, "");
}

/**
 * Problema del identificador fiscal (texto para el usuario) o null si es válido. Solo los países
 * con validación nacional comprueban el algoritmo; el resto exige un valor plausible.
 */
export function describeTaxIdProblemForCountry(value: string | null | undefined, countryCode: string | null | undefined): string | null {
  const profile = getCountryFiscalProfile(countryCode);
  if (profile.features.nationalTaxIdValidation === "es") return describeSpanishTaxIdProblem(value);
  const taxId = normalizeTaxIdForCountry(value, countryCode);
  if (!taxId) return `Indica el ${profile.taxIdLabel}.`;
  if (taxId.length < 4 || taxId.length > 20 || !/^[A-Z0-9/-]+$/.test(taxId)) {
    return `El ${profile.taxIdLabel} debe tener entre 4 y 20 letras o números.`;
  }
  return null;
}

/**
 * País deducido del identificador fiscal: un NIF-IVA europeo empieza por el código del país
 * (PT, FR, DE…; Grecia usa EL). Un NIF/CIF/NIE español sin prefijo → España. Si no se puede
 * deducir, null.
 */
export function countryFromTaxId(value: string | null | undefined): string | null {
  const taxId = (value ?? "").toUpperCase().replace(/[\s.-]/g, "");
  if (!taxId) return null;
  const prefix = taxId.slice(0, 2);
  if (/^[A-Z]{2}[0-9A-Z]{4,}$/.test(taxId)) {
    const country = normalizeCountryCode(prefix);
    if (isCountryCode(country) && (isEuCountry(country) || country === "GB" || country === "CH" || country === "NO")) return country;
  }
  if (hasSpanishTaxIdFormat(taxId)) return "ES";
  return null;
}

/**
 * Tipo de contribuyente en España deducido del NIF: DNI, NIE y NIF de personas físicas (K, L, M)
 * → autónomo; CIF de entidad (A, B, C…) → sociedad. null si no es un identificador español.
 */
export function spanishTaxpayerTypeFromTaxId(value: string | null | undefined): "company" | "individual" | null {
  const normalized = normalizeSpanishTaxId(value);
  const taxId = normalized.startsWith("ES") ? normalized.slice(2) : normalized;
  if (!hasSpanishTaxIdFormat(taxId)) return null;
  if (/^\d/.test(taxId) || /^[XYZKLM]/.test(taxId)) return "individual";
  return "company";
}
