import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { openBillingCheckout } from "@/server/billing/actions";
import { db } from "@/lib/db";
import { plan } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const payload = (await readJsonBody(request)) as { priceId?: string } | null;
  if (!payload) return invalidJsonResponse();
  if (!payload.priceId) return NextResponse.json({ message: "priceId obligatorio." }, { status: 400 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "billing.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const [allowedPlan] = await db.select({ code: plan.code }).from(plan).where(and(eq(plan.stripePriceId, payload.priceId), eq(plan.isActive, true))).limit(1);
  if (!allowedPlan) return NextResponse.json({ message: "El plan o precio seleccionado no está permitido." }, { status: 400 });
  const checkout = await openBillingCheckout({
    actor: { id: session.user.id, email: session.user.email },
    context: { tenantId: ctx.tenant.id, companyId: ctx.company.id },
    priceId: payload.priceId,
    planCode: allowedPlan.code,
    baseUrl: process.env.APP_URL ?? "http://localhost:3000",
  });
  return NextResponse.json({ url: checkout.url });
}
