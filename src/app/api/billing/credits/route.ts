import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { recordAudit } from "@/server/audit";
import { billingReturnUrl } from "@/server/billing/requests";
import { createCreditsCheckout, ensureStripeCustomer } from "@/server/billing/stripe";

const creditsSchema = z.object({ packCode: z.string().trim().min(1).max(40) });

/** Compra de un pack de créditos de lectura de facturas con IA (pago único). */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("billing.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = creditsSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Elige un pack de créditos.");
    const customerId = await ensureStripeCustomer({ tenantId: ctx.tenant.id, email: user.email, name: ctx.tenant.name });
    const checkout = await createCreditsCheckout({ tenantId: ctx.tenant.id, customerId, packCode: parsed.data.packCode, returnUrl: billingReturnUrl(), actorUserId: user.id });
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "billing.credits_checkout", entityName: "ocr_credit_ledger", entityId: checkout.id, payload: { packCode: parsed.data.packCode } });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    return handleRouteError(error, "billing.credits", "No se pudo abrir el pago. Inténtalo de nuevo en unos minutos.");
  }
}
