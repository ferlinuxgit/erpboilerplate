import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { subscription } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { recordAudit } from "@/server/audit";
import { billingReturnUrl, parseRequestedModules } from "@/server/billing/requests";
import { createSubscriptionCheckout, ensureStripeCustomer } from "@/server/billing/stripe";

/** Contratar: plan base + módulos elegidos. Con una suscripción viva se cambian los módulos (no se duplica). */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("billing.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const modules = parseRequestedModules(payload);
    const [current] = await db.select({ status: subscription.status, stripeSubscriptionId: subscription.stripeSubscriptionId }).from(subscription).where(eq(subscription.tenantId, ctx.tenant.id)).limit(1);
    if (current?.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(current.status)) {
      return jsonError(409, "Ya tienes una suscripción: cambia los módulos desde «Tu plan» o gestiona el pago en el portal.");
    }
    const customerId = await ensureStripeCustomer({ tenantId: ctx.tenant.id, email: user.email, name: ctx.tenant.name });
    const checkout = await createSubscriptionCheckout({ tenantId: ctx.tenant.id, customerId, modules, returnUrl: billingReturnUrl() });
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "billing.checkout", entityName: "subscription", entityId: checkout.id, payload: { modules } });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    return handleRouteError(error, "billing.checkout", "No se pudo abrir el pago. Inténtalo de nuevo en unos minutos.");
  }
}
