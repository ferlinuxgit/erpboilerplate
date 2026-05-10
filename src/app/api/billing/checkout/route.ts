import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { openBillingCheckout } from "@/server/billing/actions";

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const payload = (await request.json()) as { priceId?: string };
  if (!payload.priceId) return NextResponse.json({ message: "priceId obligatorio." }, { status: 400 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const checkout = await openBillingCheckout({
    actor: { id: session.user.id, email: session.user.email },
    context: { tenantId: ctx.tenant.id, companyId: ctx.company.id },
    priceId: payload.priceId,
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  });
  return NextResponse.json({ url: checkout.url });
}
