import { requirePermission } from "@/lib/rbac-server";
import type { OnboardingActor } from "@/server/onboarding/service";

/** Contexto de la puesta en marcha: solo propietarios y administradores (`settings.manage`). */
export async function requireOnboardingActor() {
  const { ctx, user } = await requirePermission("settings.manage", "Solo el propietario o un administrador puede configurar la empresa.");
  const actor: OnboardingActor = {
    tenantId: ctx.tenant.id,
    tenantName: ctx.tenant.name,
    companyId: ctx.company.id,
    companyName: ctx.company.name,
    countryCode: ctx.company.countryCode,
    fiscalYearId: ctx.fiscalYear.id,
    actorUserId: user.id,
  };
  return { actor, ctx, user };
}
