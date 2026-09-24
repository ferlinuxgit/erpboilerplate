import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { openBillingPortal } from "@/server/billing/actions";
import { getBillingViewModelForTenant } from "@/server/billing/data";

// El cliente de Stripe se toma SIEMPRE del tenant persistido; se ignora el cuerpo.
export async function POST(request: Request) {
  void request;
  try {
    const { ctx, user } = await requirePermission("billing.write");
    const billing = await getBillingViewModelForTenant(ctx.tenant.id);
    const stripeCustomerId = billing.portal.stripeCustomerId;
    if (!billing.portal.enabled || !stripeCustomerId) {
      return jsonError(400, "No hay cliente de facturación configurado.");
    }
    const portal = await openBillingPortal({
      actor: { id: user.id, email: user.email },
      context: { tenantId: ctx.tenant.id, companyId: ctx.company.id },
      stripeCustomerId,
      baseUrl: process.env.APP_URL ?? "http://localhost:3000",
    });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    return handleRouteError(error, "billing.portal", "No se pudo abrir el portal de facturación.");
  }
}
