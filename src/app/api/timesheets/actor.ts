import type { PermissionKey } from "@/lib/rbac";
import { requirePermission } from "@/lib/rbac-server";

/** Contexto de las operaciones del registro de jornada. */
export async function timesheetActor(permission: PermissionKey | null) {
  const { ctx, user } = await requirePermission(permission);
  return { ctx, userId: user.id, actor: { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id } };
}
