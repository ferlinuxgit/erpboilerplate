import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { plan } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { openBillingCheckout } from "@/server/billing/actions";

export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("billing.write");
    const payload = (await readJsonBody(request)) as { priceId?: unknown } | null;
    if (!payload) return invalidJsonResponse();
    const priceId = typeof payload.priceId === "string" ? payload.priceId.trim() : "";
    if (!priceId) return jsonError(400, "Selecciona un plan.");
    const [allowedPlan] = await db.select({ code: plan.code }).from(plan).where(and(eq(plan.stripePriceId, priceId), eq(plan.isActive, true))).limit(1);
    if (!allowedPlan) return jsonError(400, "El plan o precio seleccionado no está permitido.");
    const checkout = await openBillingCheckout({
      actor: { id: user.id, email: user.email },
      context: { tenantId: ctx.tenant.id, companyId: ctx.company.id },
      priceId,
      planCode: allowedPlan.code,
      baseUrl: process.env.APP_URL ?? "http://localhost:3000",
    });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    return handleRouteError(error, "billing.checkout", "No se pudo abrir el pago. Inténtalo de nuevo en unos minutos.");
  }
}
