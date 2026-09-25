/**
 * Reglas compartidas (cliente y servidor) sobre si una empresa está lista para
 * facturar y qué vende. Sin dependencias de base de datos.
 */

export type CompanyInvoiceFields = {
  legalName?: string | null;
  vatNumber?: string | null;
  fiscalAddress?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
};

/** Datos del emisor que exige una factura completa (art. 6 del Reglamento de facturación). */
export const requiredForInvoice = [
  ["legalName", "Razón social"],
  ["vatNumber", "CIF/NIF"],
  ["fiscalAddress", "Dirección fiscal"],
  ["postalCode", "Código postal"],
  ["city", "Ciudad"],
  ["province", "Provincia"],
] as const satisfies ReadonlyArray<readonly [keyof CompanyInvoiceFields, string]>;

export function companyInvoiceReadiness(values: CompanyInvoiceFields) {
  const missing = requiredForInvoice.filter(([key]) => !values[key]?.trim()).map(([, label]) => label);
  return { missing, ready: missing.length === 0 };
}

export const BUSINESS_TYPES = ["products", "services", "both"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const businessTypeLabels: Record<BusinessType, string> = {
  products: "Productos",
  services: "Servicios",
  both: "Productos y servicios",
};

export const businessTypeDescriptions: Record<BusinessType, string> = {
  products: "Vendes mercancía: verás inventario, albaranes y recepciones.",
  services: "Facturas horas, proyectos o cuotas: ocultamos inventario, albaranes y recepciones (siguen en la búsqueda).",
  both: "Vendes productos y servicios: verás todos los módulos.",
};

export function parseBusinessType(value: unknown): BusinessType {
  return typeof value === "string" && (BUSINESS_TYPES as readonly string[]).includes(value) ? (value as BusinessType) : "both";
}

/** IBAN sin espacios y en mayúsculas. */
export function normalizeIban(value: string) {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

/** Comprueba el formato y los dígitos de control (ISO 13616, módulo 97). */
export function isValidIban(value: string) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("ES") && iban.length !== 24) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /\d/.test(character) ? character : String(character.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Prefijo de serie de facturas: letras, números y separadores simples. */
export function isValidSeriesPrefix(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9/_-]{0,9}$/.test(value.trim());
}
