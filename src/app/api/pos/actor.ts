import { requireContext } from "@/lib/current-context";
import type { PermissionKey } from "@/lib/rbac";
import type { PosActor } from "@/server/pos/service";

/** Contexto y actor de las operaciones del TPV. */
export async function posActor(permission: PermissionKey): Promise<{ actor: PosActor; ctx: Awaited<ReturnType<typeof requireContext>> }> {
  const ctx = await requireContext(permission);
  return {
    ctx,
    actor: {
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: ctx.user.id,
      countryCode: ctx.company.countryCode,
      activeFiscalYearId: ctx.fiscalYear.id,
    },
  };
}
