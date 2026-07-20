import type { PermissionKey } from "@/lib/rbac";

export const apiKeyScopeOptions = [
  { key: "customer.read", label: "Leer clientes", group: "Clientes" },
  { key: "customer.create", label: "Gestionar clientes", group: "Clientes" },
  { key: "supplier.read", label: "Leer proveedores", group: "Proveedores" },
  { key: "supplier.create", label: "Gestionar proveedores", group: "Proveedores" },
  { key: "invoice.read", label: "Leer facturas y PDF", group: "Facturación" },
  { key: "invoice.create", label: "Crear facturas", group: "Facturación" },
  { key: "invoice.write", label: "Corregir o anular facturas", group: "Facturación" },
  { key: "purchase.read", label: "Leer pedidos de compra y PDF", group: "Compras" },
] as const satisfies ReadonlyArray<{ key: PermissionKey; label: string; group: string }>;

export const apiKeyScopeKeys = new Set<PermissionKey>(apiKeyScopeOptions.map((option) => option.key));

export function normalizeApiKeyScopes(input: unknown): PermissionKey[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((scope): scope is PermissionKey => typeof scope === "string" && apiKeyScopeKeys.has(scope as PermissionKey)))];
}

export function parseStoredApiKeyScopes(value: string): PermissionKey[] {
  try {
    return normalizeApiKeyScopes(JSON.parse(value));
  } catch {
    return [];
  }
}
