/**
 * Códigos DIR3 (Directorio Común de Unidades Orgánicas y Oficinas) que identifican a una
 * Administración pública en la factura electrónica. Sin dependencias: se usa también en los
 * formularios de cliente.
 */

/** Códigos DIR3 del cliente cuando es una Administración pública (obligatorios para FACe). */
export type Dir3Codes = {
  /** Oficina contable (rol 01 «Fiscal» de Facturae). */
  accountingOffice?: string | null;
  /** Órgano gestor (rol 02 «Receptor»). */
  managingBody?: string | null;
  /** Unidad tramitadora (rol 03 «Pagador»). */
  processingUnit?: string | null;
  /** Órgano proponente (rol 04 «Comprador»), opcional. */
  proposingBody?: string | null;
};

/** Código DIR3 normalizado (mayúsculas, sin espacios) o null si está vacío. */
export function normalizeDir3(value: string | null | undefined): string | null {
  const code = (value ?? "").toUpperCase().replace(/\s+/g, "");
  return code || null;
}

/**
 * Formato de un código del Directorio Común (DIR3): 9 caracteres, una o dos letras de ámbito
 * (A, E, EA, GE, I, J, L, LA, U…) seguidas de dígitos. Solo se comprueba la forma: que el código
 * exista lo dice el directorio de FACe, no la aplicación.
 */
export function isValidDir3(value: string | null | undefined): boolean {
  const code = normalizeDir3(value);
  return Boolean(code && /^[A-Z]{1,2}[0-9]{7,8}$/.test(code) && code.length === 9);
}

export function hasAnyDir3(dir3: Dir3Codes | null | undefined): boolean {
  return Boolean(dir3 && (normalizeDir3(dir3.accountingOffice) || normalizeDir3(dir3.managingBody) || normalizeDir3(dir3.processingUnit) || normalizeDir3(dir3.proposingBody)));
}

/** Los tres códigos que FACe exige en toda factura: oficina contable, órgano gestor y unidad tramitadora. */
export function missingDir3(dir3: Dir3Codes | null | undefined): string[] {
  const missing: string[] = [];
  if (!normalizeDir3(dir3?.accountingOffice)) missing.push("oficina contable");
  if (!normalizeDir3(dir3?.managingBody)) missing.push("órgano gestor");
  if (!normalizeDir3(dir3?.processingUnit)) missing.push("unidad tramitadora");
  return missing;
}
