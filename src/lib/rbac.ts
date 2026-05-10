import { eq, inArray } from "drizzle-orm";

import { permission, rolePermission } from "@/db/schema";
import { db } from "@/lib/db";

export type AppRole = "OWNER" | "ADMIN" | "MEMBER";

export type PermissionKey =
  | "customer.read"
  | "customer.create"
  | "invoice.read"
  | "invoice.create"
  | "invoice.write"
  | "purchase.read"
  | "purchase.create"
  | "purchase.write"
  | "treasury.read"
  | "treasury.write"
  | "stock.read"
  | "stock.write"
  | "series.read"
  | "series.write"
  | "accounting.read"
  | "accounting.write"
  | "fiscal.read"
  | "fiscal.write"
  | "team.read"
  | "team.write"
  | "billing.read"
  | "billing.write"
  | "reporting.read"
  | "apiKey.read"
  | "apiKey.write"
  | "settings.manage";

const rolePermissions: Record<AppRole, Set<PermissionKey>> = {
  OWNER: new Set<PermissionKey>([
    "customer.read",
    "customer.create",
    "invoice.read",
    "invoice.create",
    "invoice.write",
    "purchase.read",
    "purchase.create",
    "purchase.write",
    "treasury.read",
    "treasury.write",
    "stock.read",
    "stock.write",
    "series.read",
    "series.write",
    "accounting.read",
    "accounting.write",
    "fiscal.read",
    "fiscal.write",
    "team.read",
    "team.write",
    "billing.read",
    "billing.write",
    "reporting.read",
    "apiKey.read",
    "apiKey.write",
    "settings.manage",
  ]),
  ADMIN: new Set<PermissionKey>([
    "customer.read",
    "customer.create",
    "invoice.read",
    "invoice.create",
    "invoice.write",
    "purchase.read",
    "purchase.create",
    "purchase.write",
    "treasury.read",
    "treasury.write",
    "stock.read",
    "stock.write",
    "series.read",
    "series.write",
    "accounting.read",
    "accounting.write",
    "fiscal.read",
    "fiscal.write",
    "team.read",
    "team.write",
    "billing.read",
    "reporting.read",
    "apiKey.read",
    "apiKey.write",
    "settings.manage",
  ]),
  MEMBER: new Set<PermissionKey>([
    "customer.read",
    "invoice.read",
    "purchase.read",
    "treasury.read",
    "stock.read",
    "series.read",
    "accounting.read",
    "fiscal.read",
    "reporting.read",
  ]),
};

let rbacSeeded = false;

export function can(role: AppRole, permission: PermissionKey): boolean {
  return rolePermissions[role].has(permission);
}

export function canManageCustomers(role: AppRole): boolean {
  return can(role, "customer.create");
}

export function canManageInvoices(role: AppRole): boolean {
  return can(role, "invoice.create");
}

type PermissionsCacheEntry = {
  permissions: Set<PermissionKey>;
  expiresAt: number;
};

const CACHE_TTL_MS = 60_000;
const rolePermissionsCache = new Map<AppRole, PermissionsCacheEntry>();

async function loadPermissionsFromDb(role: AppRole): Promise<Set<PermissionKey> | null> {
  const cached = rolePermissionsCache.get(role);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions;
  }

  const assigned = await db
    .select({
      permissionKey: rolePermission.permissionKey,
    })
    .from(rolePermission)
    .where(eq(rolePermission.role, role));

  if (assigned.length === 0) {
    return null;
  }

  const keys = assigned.map((entry) => entry.permissionKey) as PermissionKey[];
  const available = await db
    .select({ key: permission.key })
    .from(permission)
    .where(inArray(permission.key, keys));

  const permissions = new Set(available.map((entry) => entry.key as PermissionKey));
  rolePermissionsCache.set(role, { permissions, expiresAt: Date.now() + CACHE_TTL_MS });
  return permissions;
}

export async function canFromDb(role: AppRole, permissionKey: PermissionKey): Promise<boolean> {
  await ensureRbacSeed();
  const dynamicPermissions = await loadPermissionsFromDb(role);
  if (!dynamicPermissions) {
    return can(role, permissionKey);
  }

  return dynamicPermissions.has(permissionKey);
}

export async function ensureRbacSeed() {
  if (rbacSeeded) return;

  const permissionRows = (Object.values(rolePermissions).flatMap((set) => [...set]) as PermissionKey[]).filter(
    (value, index, values) => values.indexOf(value) === index,
  );

  for (const key of permissionRows) {
    await db
      .insert(permission)
      .values({ key, description: `Permiso ${key}` })
      .onConflictDoNothing();
  }

  for (const [role, keys] of Object.entries(rolePermissions) as Array<[AppRole, Set<PermissionKey>]>) {
    for (const key of keys) {
      await db
        .insert(rolePermission)
        .values({ role, permissionKey: key })
        .onConflictDoNothing();
    }
  }

  rbacSeeded = true;
}
