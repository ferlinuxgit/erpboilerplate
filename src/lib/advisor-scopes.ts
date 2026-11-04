/**
 * Secciones del portal del asesor (`/asesor`). Cada acceso de asesor ve solo las que tiene
 * concedidas; el resumen y los datos fiscales de la empresa son siempre visibles.
 */

export const ADVISOR_SCOPES = ["sales", "expenses", "accounting", "taxes", "banking", "pos"] as const;

export type AdvisorScope = (typeof ADVISOR_SCOPES)[number];

export const advisorScopeOptions: Array<{ key: AdvisorScope; label: string; description: string }> = [
  { key: "sales", label: "Ventas", description: "Facturas emitidas y rectificativas (PDF), listado de ventas, clientes y cobros." },
  { key: "expenses", label: "Gastos y compras", description: "Facturas recibidas con su documento original, listado de gastos, proveedores y pagos." },
  { key: "accounting", label: "Contabilidad", description: "Libro diario, libro mayor, sumas y saldos y paquete contable del periodo." },
  { key: "taxes", label: "Impuestos", description: "Libros registro de IVA, modelos (303, 111, 115, 130, 347, 349, 390…) y su estado de presentación." },
  { key: "banking", label: "Bancos", description: "Movimientos bancarios del periodo con su estado de conciliación." },
  { key: "pos", label: "TPV", description: "Cierres de caja (informes Z) con ventas, cobros por medio de pago y descuadres." },
];

export const DEFAULT_ADVISOR_SCOPES: AdvisorScope[] = ["sales", "expenses", "accounting", "taxes", "banking", "pos"];

export function isAdvisorScope(value: unknown): value is AdvisorScope {
  return typeof value === "string" && (ADVISOR_SCOPES as readonly string[]).includes(value);
}

/** Secciones guardadas, limpias (descarta valores desconocidos y duplicados) y en el orden canónico. */
export function normalizeAdvisorScopes(values: unknown): AdvisorScope[] {
  if (!Array.isArray(values)) return [];
  const wanted = new Set(values.filter(isAdvisorScope));
  return ADVISOR_SCOPES.filter((scope) => wanted.has(scope));
}

export function advisorScopeLabel(scope: AdvisorScope) {
  return advisorScopeOptions.find((option) => option.key === scope)?.label ?? scope;
}

/** Longitud mínima de la contraseña del asesor (se comparte fuera del ERP: mejor larga). */
export const ADVISOR_PASSWORD_MIN_LENGTH = 10;

/** Ruta del portal y de su pantalla de acceso. */
export const ADVISOR_PORTAL_PATH = "/asesor";
export const ADVISOR_LOGIN_PATH = "/asesor/acceso";
