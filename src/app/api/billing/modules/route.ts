import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { subscription } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { MODULES } from "@/modules/registry";
import { recordAudit } from "@/server/audit";
import { parseRequestedModules } from "@/server/billing/requests";
import { cancelModulesSubscription, createModulesSubscription, isCombinedMonthlySubscription, updateSubscriptionModules } from "@/server/billing/stripe";
import { setCompanyModule } from "@/server/modules/service";

const LIVE = ["ACTIVE", "TRIALING", "PAST_DUE"];

/**
 * Cambia los módulos contratados (prorrateado). El plan base es anual y los módulos van en su
 * propia suscripción mensual: se crea con el primer módulo y se cancela al quitar el último. Las
 * suscripciones antiguas (plan y módulos juntos, al mes) se siguen cambiando en la misma.
 * Los módulos añadidos quedan además activados en la empresa activa.
 */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("billing.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const modules = parseRequestedModules(payload);
    const [current] = await db
      .select({
        status: subscription.status,
        addons: subscription.addons,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        stripeModulesSubscriptionId: subscription.stripeModulesSubscriptionId,
      })
      .from(subscription)
      .where(eq(subscription.tenantId, ctx.tenant.id))
      .limit(1);
    if (!current?.stripeSubscriptionId || !current.stripeCustomerId || !LIVE.includes(current.status)) {
      return jsonError(409, "Todavía no tienes una suscripción: contrata el plan con los módulos que quieras.");
    }

    let payUrl: string | null = null;
    let target = current.stripeModulesSubscriptionId;
    if (current.stripeModulesSubscriptionId) {
      if (modules.length === 0) await cancelModulesSubscription(current.stripeModulesSubscriptionId);
      else await updateSubscriptionModules({ stripeSubscriptionId: current.stripeModulesSubscriptionId, modules });
    } else if (await isCombinedMonthlySubscription(current.stripeSubscriptionId)) {
      target = current.stripeSubscriptionId;
      await updateSubscriptionModules({ stripeSubscriptionId: current.stripeSubscriptionId, modules });
    } else if (modules.length > 0) {
      const created = await createModulesSubscription({
        tenantId: ctx.tenant.id,
        customerId: current.stripeCustomerId,
        planSubscriptionId: current.stripeSubscriptionId,
        modules,
        // Un doble clic en el mismo minuto no crea dos suscripciones.
        idempotencyKey: `modules-${ctx.tenant.id}-${modules.join(",")}-${Math.floor(Date.now() / 60_000)}`,
      });
      target = created.subscription.id;
      payUrl = created.payUrl;
      await db
        .update(subscription)
        .set({ stripeModulesSubscriptionId: created.subscription.id, modulesStatus: created.subscription.status.toUpperCase() })
        .where(eq(subscription.tenantId, ctx.tenant.id));
    }

    // Stripe lo confirma por webhook; se guarda ya para que el cambio se note al instante
    // (salvo si falta confirmar el pago: los módulos llegan cuando se pague).
    if (!payUrl) await db.update(subscription).set({ addons: [...modules].sort() }).where(eq(subscription.tenantId, ctx.tenant.id));
    const added = payUrl ? [] : modules.filter((moduleId) => !current.addons.includes(moduleId));
    // En orden del registro: un módulo se activa después de aquellos de los que depende.
    for (const manifest of MODULES.filter((entry) => added.includes(entry.id))) {
      await setCompanyModule({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, moduleId: manifest.id, enabled: true }).catch(() => undefined);
    }
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "billing.modules", entityName: "subscription", entityId: target ?? current.stripeSubscriptionId, payload: { before: current.addons, after: modules, pendingPayment: Boolean(payUrl) } });
    return NextResponse.json({ modules, ...(payUrl ? { url: payUrl } : {}) });
  } catch (error) {
    return handleRouteError(error, "billing.modules", "No se pudieron cambiar los módulos. Inténtalo de nuevo.");
  }
}
