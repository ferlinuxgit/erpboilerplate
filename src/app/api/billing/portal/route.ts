import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { subscription } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, jsonError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { recordAudit } from "@/server/audit";
import { billingReturnUrl } from "@/server/billing/requests";
import { createPortalSession } from "@/server/billing/stripe";

/** Portal de Stripe (método de pago, facturas, cancelación). El cliente sale SIEMPRE del espacio guardado. */
export async function POST() {
  try {
    const { ctx, user } = await requirePermission("billing.write");
    const [row] = await db.select({ stripeCustomerId: subscription.stripeCustomerId }).from(subscription).where(eq(subscription.tenantId, ctx.tenant.id)).limit(1);
    if (!row?.stripeCustomerId) return jsonError(400, "Todavía no tienes datos de pago: contrata el plan o compra créditos primero.");
    const portal = await createPortalSession(row.stripeCustomerId, billingReturnUrl());
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "billing.portal", entityName: "subscription", entityId: row.stripeCustomerId, payload: {} });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    return handleRouteError(error, "billing.portal", "No se pudo abrir el portal de facturación.");
  }
}
