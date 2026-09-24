import { and, eq } from "drizzle-orm";

import { rolePermission } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/http";
import { can, type AppRole, type PermissionKey } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

/**
 * Helper canónico de autorización para route handlers (sesión de usuario):
 * sesión → tenant/empresa activos → `can(role, permission)`.
 *
 * Lanza `UnauthorizedError` (401) o `ForbiddenError` (403); combínalo con
 * `handleRouteError` de `@/lib/http`. En UI sigue usándose `can()` de `@/lib/rbac`.
 *
 * ```ts
 * try {
 *   const { ctx, user } = await requirePermission("stock.read");
 *   ...
 * } catch (error) {
 *   return handleRouteError(error, "inventory.alerts");
 * }
 * ```
 */
export async function requirePermission(permission: PermissionKey | null, forbiddenMessage?: string) {
  const session = await getUserSession();
  if (!session?.user) throw new UnauthorizedError();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (permission && !can(ctx.membership.role, permission)) throw new ForbiddenError(forbiddenMessage);
  return { ctx, user: session.user };
}

/**
 * @deprecated `role_permission` es global (no por tenant) y hoy no se puebla;
 * usa `requirePermission` (API) o `can()` (UI). Se mantiene por compatibilidad.
 */
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
