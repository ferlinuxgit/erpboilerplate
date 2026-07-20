import "server-only";

import { and, eq } from "drizzle-orm";

import { rolePermission } from "@/db/schema";
import { db } from "@/lib/db";
import { can, type AppRole, type PermissionKey } from "@/lib/rbac";

export async function canFromDb(role: AppRole, permissionKey: PermissionKey): Promise<boolean> {
  const configured = await db.select({ permissionKey: rolePermission.permissionKey }).from(rolePermission).where(eq(rolePermission.role, role));
  if (configured.length === 0) return can(role, permissionKey);
  const [granted] = await db
    .select({ id: rolePermission.id })
    .from(rolePermission)
    .where(and(eq(rolePermission.role, role), eq(rolePermission.permissionKey, permissionKey)))
    .limit(1);
  return Boolean(granted);
}
