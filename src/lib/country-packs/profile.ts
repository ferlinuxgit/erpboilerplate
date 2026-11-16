/**
 * Paquetes fiscales por país: TODO lo que cambia de un país a otro se decide aquí, a partir del
 * país de la empresa, para que el usuario no tenga que configurar nada.
 *
 * Niveles de cumplimiento:
 * - "full": el país tiene paquete propio (plantilla contable, impuestos, modelos oficiales,
 *   facturación verificable…). Hoy: España.
 * - "basic": cualquier otro país. Factura con los tipos de IVA del país, contabiliza con el plan
 *   genérico y ofrece un resumen de IVA por periodo (repercutido − soportado), sin modelos oficiales.
 *
 * Para dar cumplimiento completo a un país nuevo: añadir su entrada en `fullPacks` con sus
 * capacidades y, si las tiene, sus pantallas (modelos, facturación electrónica…) colgando de ellas.
 * Ningún código fuera de este módulo debe preguntar `countryCode === "ES"`: debe preguntar por la
 * capacidad (`pack.features.*`).
 */

import { countryName, isEuCountry, normalizeCountryCode } from "@/lib/countries";
import { countryVatRates, type ConsumptionTaxSystem } from "@/lib/country-packs/vat-rates";

export type ComplianceLevel = "full" | "basic";

export type CountryFeatures = {
  /** Modelos oficiales de la administración tributaria (303, 111, 347…). null = resumen genérico. */
  taxReports: "es-aeat" | null;
  /** Sistema de facturación verificable / factura electrónica obligatoria. */
  eInvoicing: "verifactu" | null;
  /** Régimen de recargo de equivalencia (comercio minorista). */
  equivalenceSurcharge: boolean;
  /** Retenciones a cuenta del impuesto sobre la renta en facturas de profesionales y alquileres. */
  incomeTaxWithholding: boolean;
  /** Prorrata de deducción del IVA soportado. */
  vatProration: boolean;
  /** Validación del identificador fiscal nacional con su algoritmo oficial. */
  nationalTaxIdValidation: "es" | null;
  /** Comprobación de NIF-IVA de clientes de otros países de la UE en VIES. */
  vies: boolean;
};

export type CountryFiscalProfile = {
  countryCode: string;
  countryName: string;
  level: ComplianceLevel;
  /** Moneda, zona horaria e idioma por defecto de la empresa. */
  currency: string;
  timezone: string;
  /** Sistema del impuesto sobre el consumo y su nombre local ("IVA", "TVA", "VAT"…). */
  taxSystem: ConsumptionTaxSystem;
  taxLabel: string;
  /** Nombre del identificador fiscal en formularios ("NIF", "NIF-IVA"…). */
  taxIdLabel: string;
  isEu: boolean;
  /**
   * Estructura del plan contable. "PGC": cuentas numeradas por grupos (1 financiación … 6 gastos,
   * 7 ingresos), la del PGC español y de la plantilla genérica; los asientos automáticos, el cierre
   * y los estados financieros se apoyan en ella. Un país con otro plan (p. ej. US GAAP por tipos)
   * declarará aquí su familia.
   */
  chartFamily: "PGC";
  features: CountryFeatures;
};

const basicFeatures = (isEu: boolean): CountryFeatures => ({
  taxReports: null,
  eInvoicing: null,
  equivalenceSurcharge: false,
  incomeTaxWithholding: false,
  vatProration: false,
  nationalTaxIdValidation: null,
  vies: isEu,
});

/** Países con cumplimiento completo. */
const fullPacks: Record<string, Pick<CountryFiscalProfile, "currency" | "timezone" | "taxIdLabel" | "features">> = {
  ES: {
    currency: "EUR",
    timezone: "Europe/Madrid",
    taxIdLabel: "NIF",
    features: {
      taxReports: "es-aeat",
      eInvoicing: "verifactu",
      equivalenceSurcharge: true,
      incomeTaxWithholding: true,
      vatProration: true,
      nationalTaxIdValidation: "es",
      vies: true,
    },
  },
};

/** Moneda y zona horaria por defecto de los países sin paquete completo. */
const countryDefaults: Record<string, { currency: string; timezone: string }> = {
  AD: { currency: "EUR", timezone: "Europe/Andorra" },
  AE: { currency: "AED", timezone: "Asia/Dubai" },
  AR: { currency: "ARS", timezone: "America/Argentina/Buenos_Aires" },
  AT: { currency: "EUR", timezone: "Europe/Vienna" },
  AU: { currency: "AUD", timezone: "Australia/Sydney" },
  BE: { currency: "EUR", timezone: "Europe/Brussels" },
  BG: { currency: "EUR", timezone: "Europe/Sofia" },
  BO: { currency: "BOB", timezone: "America/La_Paz" },
  BR: { currency: "BRL", timezone: "America/Sao_Paulo" },
  CA: { currency: "CAD", timezone: "America/Toronto" },
  CH: { currency: "CHF", timezone: "Europe/Zurich" },
  CL: { currency: "CLP", timezone: "America/Santiago" },
  CN: { currency: "CNY", timezone: "Asia/Shanghai" },
  CO: { currency: "COP", timezone: "America/Bogota" },
  CR: { currency: "CRC", timezone: "America/Costa_Rica" },
  CY: { currency: "EUR", timezone: "Asia/Nicosia" },
  CZ: { currency: "CZK", timezone: "Europe/Prague" },
  DE: { currency: "EUR", timezone: "Europe/Berlin" },
  DK: { currency: "DKK", timezone: "Europe/Copenhagen" },
  DO: { currency: "DOP", timezone: "America/Santo_Domingo" },
  EC: { currency: "USD", timezone: "America/Guayaquil" },
  EE: { currency: "EUR", timezone: "Europe/Tallinn" },
  FI: { currency: "EUR", timezone: "Europe/Helsinki" },
  FR: { currency: "EUR", timezone: "Europe/Paris" },
  GB: { currency: "GBP", timezone: "Europe/London" },
  GR: { currency: "EUR", timezone: "Europe/Athens" },
  GT: { currency: "GTQ", timezone: "America/Guatemala" },
  HR: { currency: "EUR", timezone: "Europe/Zagreb" },
  HU: { currency: "HUF", timezone: "Europe/Budapest" },
  IE: { currency: "EUR", timezone: "Europe/Dublin" },
  IT: { currency: "EUR", timezone: "Europe/Rome" },
  JP: { currency: "JPY", timezone: "Asia/Tokyo" },
  LT: { currency: "EUR", timezone: "Europe/Vilnius" },
  LU: { currency: "EUR", timezone: "Europe/Luxembourg" },
  LV: { currency: "EUR", timezone: "Europe/Riga" },
  MA: { currency: "MAD", timezone: "Africa/Casablanca" },
  MT: { currency: "EUR", timezone: "Europe/Malta" },
  MX: { currency: "MXN", timezone: "America/Mexico_City" },
  NL: { currency: "EUR", timezone: "Europe/Amsterdam" },
  NO: { currency: "NOK", timezone: "Europe/Oslo" },
  NZ: { currency: "NZD", timezone: "Pacific/Auckland" },
  PA: { currency: "USD", timezone: "America/Panama" },
  PE: { currency: "PEN", timezone: "America/Lima" },
  PL: { currency: "PLN", timezone: "Europe/Warsaw" },
  PT: { currency: "EUR", timezone: "Europe/Lisbon" },
  PY: { currency: "PYG", timezone: "America/Asuncion" },
  RO: { currency: "RON", timezone: "Europe/Bucharest" },
  SE: { currency: "SEK", timezone: "Europe/Stockholm" },
  SI: { currency: "EUR", timezone: "Europe/Ljubljana" },
  SK: { currency: "EUR", timezone: "Europe/Bratislava" },
  SV: { currency: "USD", timezone: "America/El_Salvador" },
  US: { currency: "USD", timezone: "America/New_York" },
  UY: { currency: "UYU", timezone: "America/Montevideo" },
  VE: { currency: "VES", timezone: "America/Caracas" },
};

function normalizePackCountry(countryCode: string | null | undefined) {
  return normalizeCountryCode(countryCode) || "ES";
}

/**
 * Perfil fiscal del país (cualquier país del mundo tiene uno: completo o básico). Código puro y
 * ligero: se puede usar en componentes cliente. La plantilla contable está en `getCountryPack`.
 */
export function getCountryFiscalProfile(countryCode: string | null | undefined): CountryFiscalProfile {
  const code = normalizePackCountry(countryCode);
  const rates = countryVatRates(code);
  const full = fullPacks[code];
  const isEu = isEuCountry(code);
  const defaults = countryDefaults[code] ?? { currency: isEu ? "EUR" : "USD", timezone: "UTC" };
  return {
    countryCode: code,
    countryName: countryName(code),
    level: full ? "full" : "basic",
    currency: full?.currency ?? defaults.currency,
    timezone: full?.timezone ?? defaults.timezone,
    taxSystem: rates?.system ?? "NONE",
    taxLabel: rates?.label ?? "Impuesto",
    taxIdLabel: full?.taxIdLabel ?? (isEu ? "NIF-IVA" : "Identificador fiscal"),
    isEu,
    chartFamily: "PGC",
    features: full?.features ?? basicFeatures(isEu),
  };
}

/** ¿El plan contable de la empresa sigue la numeración por grupos del PGC? */
export function usesPgcChart(countryCode: string | null | undefined) {
  return getCountryFiscalProfile(countryCode).chartFamily === "PGC";
}

export function isFullComplianceCountry(countryCode: string | null | undefined) {
  return getCountryFiscalProfile(countryCode).level === "full";
}
