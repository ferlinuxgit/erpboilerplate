import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { openBillingPortal } from "@/server/billing/actions";
import { getBillingViewModelForTenant } from "@/server/billing/data";

export async function POST(request: Request) {
  void request;
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const billing = await getBillingViewModelForTenant(ctx.tenant.id);
  const stripeCustomerId = billing.portal.stripeCustomerId;
  if (!billing.portal.enabled || !stripeCustomerId) {
    return NextResponse.json({ message: "No hay cliente de facturación configurado." }, { status: 400 });
  }
  const portal = await openBillingPortal({
    actor: { id: session.user.id, email: session.user.email },
    context: { tenantId: ctx.tenant.id, companyId: ctx.company.id },
    stripeCustomerId,
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  });
  return NextResponse.json({ url: portal.url });
}
