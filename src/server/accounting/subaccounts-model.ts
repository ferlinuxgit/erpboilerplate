/**
 * Reglas puras del plan contable por subcuentas (PGC 2007/PYMES).
 *
 * - Solo se apunta en subcuentas de longitud fija (8 por defecto, de 8 a 12 dígitos). Las cuentas
 *   de 1 a 4 dígitos del PGC (y cualquier código más corto) son cuentas de agrupación.
 * - La subcuenta canónica de una cuenta se obtiene completando con ceros por la derecha:
 *   477 → 47700000, 4751 → 47510000, 700000 → 70000000.
 * - Cada tercero tiene su subcuenta: 430 + número (clientes), 400 (proveedores de mercaderías) o
 *   410 (acreedores por servicios) + número, p. ej. 43000001. La terminación 0 queda para la
 *   subcuenta genérica (43000000) de los apuntes sin tercero conocido.
 */

export const DEFAULT_SUBACCOUNT_LENGTH = 8;
export const MIN_SUBACCOUNT_LENGTH = 8;
export const MAX_SUBACCOUNT_LENGTH = 12;

export type PartnerAccountRole = "customer" | "supplier";
export type SupplierKind = "GOODS" | "SERVICES";
export type AccountNature = "DEBIT" | "CREDIT" | "MIXED";

export const SUPPLIER_KINDS: readonly SupplierKind[] = ["GOODS", "SERVICES"];

export const SUPPLIER_KIND_LABELS: Record<SupplierKind, string> = {
  GOODS: "Mercaderías (400)",
  SERVICES: "Servicios / acreedores (410)",
};

export function isSupplierKind(value: unknown): value is SupplierKind {
  return value === "GOODS" || value === "SERVICES";
}

/** Longitud válida (8–12); cualquier otro valor cae a 8. */
export function normalizeSubaccountLength(value: unknown): number {
  const length = Math.trunc(Number(value));
  if (!Number.isFinite(length) || length < MIN_SUBACCOUNT_LENGTH || length > MAX_SUBACCOUNT_LENGTH) return DEFAULT_SUBACCOUNT_LENGTH;
  return length;
}

export function isValidSubaccountLength(value: unknown) {
  const length = Number(value);
  return Number.isInteger(length) && length >= MIN_SUBACCOUNT_LENGTH && length <= MAX_SUBACCOUNT_LENGTH;
}

export function isNumericAccountCode(code: string) {
  return /^\d+$/.test(code);
}

/** Una cuenta admite apuntes solo si es una subcuenta numérica de la longitud de la empresa. */
export function isCanonicalSubaccountCode(code: string, length: number) {
  return isNumericAccountCode(code) && code.length === length;
}

/**
 * Subcuenta canónica de un código: se completa con ceros por la derecha hasta la longitud.
 * Devuelve null si el código no es numérico o es más largo que la longitud de la empresa.
 */
export function canonicalSubaccountCode(code: string, length: number): string | null {
  const trimmed = code.trim();
  if (!trimmed || !isNumericAccountCode(trimmed) || trimmed.length > length) return null;
  return trimmed.padEnd(length, "0");
}

/**
 * Atajo del punto (ContaPlus/Sage): «43.1» → 43000001, «572.» → 57200000, «4.12» → 40000012.
 * El punto se rellena con ceros hasta la longitud de subcuenta. null si no es un atajo válido.
 */
export function expandDotShortcut(value: string, length: number): string | null {
  const match = /^(\d+)\.(\d*)$/.exec(value.trim());
  if (!match) return null;
  const [, prefix, suffix] = match;
  if (prefix.length + suffix.length > length) return null;
  const sequence = Number(suffix || "0");
  if (sequence === 0) return canonicalSubaccountCode(prefix, length);
  return partnerSubaccountCode(prefix, sequence, length);
}

/** Prefijos estrictos de un código (1, 12, 123…), del más corto al más largo. */
export function ancestorCodes(code: string): string[] {
  const prefixes: string[] = [];
  for (let size = 1; size < code.length; size += 1) prefixes.push(code.slice(0, size));
  return prefixes;
}

/** Cuenta de grupo más cercana (prefijo más largo) de entre los códigos existentes. */
export function nearestAncestorCode(code: string, existingCodes: Iterable<string>): string | null {
  const existing = new Set(existingCodes);
  const prefixes = ancestorCodes(code);
  for (let index = prefixes.length - 1; index >= 0; index -= 1) {
    if (existing.has(prefixes[index])) return prefixes[index];
  }
  return null;
}

/** Tipo de proveedor por defecto según lo que vende la empresa: servicios → 410; productos o ambos → 400. */
export function defaultSupplierKind(businessType: string | null | undefined): SupplierKind {
  return businessType === "services" ? "SERVICES" : "GOODS";
}

/**
 * Cuenta de grupo (3 dígitos) de la subcuenta de un tercero.
 * España: 430 clientes; 400 proveedores de mercaderías; 410 acreedores por servicios.
 * Otros planes: los 3 primeros dígitos de las cuentas de clientes/proveedores configuradas.
 */
export function partnerAccountPrefix(input: {
  role: PartnerAccountRole;
  supplierKind: SupplierKind;
  countryCode: string;
  customerCode?: string | null;
  supplierCode?: string | null;
}) {
  if (input.countryCode.toUpperCase() === "ES") {
    if (input.role === "customer") return "430";
    return input.supplierKind === "SERVICES" ? "410" : "400";
  }
  const configured = input.role === "customer" ? input.customerCode : input.supplierCode;
  const digits = (configured ?? "").replace(/\D/g, "").slice(0, 3);
  if (digits.length === 3) return digits;
  return input.role === "customer" ? "430" : input.supplierKind === "SERVICES" ? "410" : "400";
}

/** Número del tercero (CL000012, PR000007…) → 12, 7. null si no tiene dígitos. */
export function partnerSequenceFromNumber(partnerNumber: string | null | undefined): number | null {
  const match = /(\d+)\s*$/.exec(partnerNumber ?? "");
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 430 + 1 con longitud 8 → 43000001. null si el número no cabe en la subcuenta. */
export function partnerSubaccountCode(prefix: string, sequence: number, length: number): string | null {
  const width = length - prefix.length;
  if (width <= 0 || !Number.isSafeInteger(sequence) || sequence < 1) return null;
  const suffix = String(sequence);
  if (suffix.length > width) return null;
  return `${prefix}${suffix.padStart(width, "0")}`;
}

/** Siguiente subcuenta libre del prefijo (tras la mayor existente). null si el rango está lleno. */
export function nextFreePartnerSubaccountCode(prefix: string, length: number, existingCodes: Iterable<string>): string | null {
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix) || code.length !== length || !isNumericAccountCode(code)) continue;
    const suffix = Number(code.slice(prefix.length));
    if (suffix > max) max = suffix;
  }
  return partnerSubaccountCode(prefix, max + 1, length);
}

/** Naturaleza del saldo por tipo de cuenta: activo y gasto deudoras; pasivo, patrimonio e ingreso acreedoras. */
export function natureForAccountType(type: string): AccountNature {
  if (type === "ASSET" || type === "EXPENSE") return "DEBIT";
  if (type === "LIABILITY" || type === "EQUITY" || type === "REVENUE") return "CREDIT";
  return "MIXED";
}

/** Grupo de 3 dígitos de una cuenta (para comparar sumas y saldos antes y después de reclasificar). */
export function accountGroupCode(code: string) {
  return code.slice(0, 3);
}

/** Misma subcuenta canónica: 572, 5720 y 57200000 son la misma cuenta de apuntes. */
export function sameCanonicalAccount(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  return left.padEnd(length, "0") === right.padEnd(length, "0");
}
