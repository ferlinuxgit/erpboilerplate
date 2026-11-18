import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { subscription } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { MODULES } from "@/modules/registry";
import { recordAudit } from "@/server/audit";
import { parseRequestedModules } from "@/server/billing/requests";
import { updateSubscriptionModules } from "@/server/billing/stripe";
import { setCompanyModule } from "@/server/modules/service";

/**
 * Cambia los módulos contratados de una suscripción en curso (prorrateado). Los módulos añadidos
 * quedan además activados en la empresa activa.
 */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("billing.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const modules = parseRequestedModules(payload);
    const [current] = await db.select({ status: subscription.status, addons: subscription.addons, stripeSubscriptionId: subscription.stripeSubscriptionId }).from(subscription).where(eq(subscription.tenantId, ctx.tenant.id)).limit(1);
    if (!current?.stripeSubscriptionId || !["ACTIVE", "TRIALING", "PAST_DUE"].includes(current.status)) {
      return jsonError(409, "Todavía no tienes una suscripción: contrata el plan con los módulos que quieras.");
    }
    await updateSubscriptionModules({ stripeSubscriptionId: current.stripeSubscriptionId, modules });
    // Stripe lo confirma por webhook; se guarda ya para que el cambio se note al instante.
    await db.update(subscription).set({ addons: [...modules].sort() }).where(eq(subscription.tenantId, ctx.tenant.id));
    const added = modules.filter((moduleId) => !current.addons.includes(moduleId));
    // En orden del registro: un módulo se activa después de aquellos de los que depende.
    for (const manifest of MODULES.filter((entry) => added.includes(entry.id))) {
      await setCompanyModule({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, moduleId: manifest.id, enabled: true }).catch(() => undefined);
    }
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "billing.modules", entityName: "subscription", entityId: current.stripeSubscriptionId, payload: { before: current.addons, after: modules } });
    return NextResponse.json({ modules });
  } catch (error) {
    return handleRouteError(error, "billing.modules", "No se pudieron cambiar los módulos. Inténtalo de nuevo.");
  }
}
