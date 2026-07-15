import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { stripe } from "@/server/billing/stripe";
import { db } from "@/lib/db";
import { subscription, tenant } from "@/db/schema";
import { eq } from "drizzle-orm";

function stripeId(value: string | { id: string } | null) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function periodEnd(value: number | null | undefined) {
  return value ? new Date(value * 1000) : null;
}

export async function POST(request: Request) {
  if (!stripe) return NextResponse.json({ message: "Stripe no configurado." }, { status: 400 });
  const body = await request.text();
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ message: "Webhook no configurado." }, { status: 400 });
  try {
    const event = stripe.webhooks.constructEvent(body, signature, secret);
    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object;
      const tenantId = checkout.metadata?.tenantId ?? checkout.client_reference_id;
      const planCode = checkout.metadata?.planCode;
      if (tenantId && planCode) {
        await db.insert(subscription).values({ tenantId, plan: planCode, status: "ACTIVE", stripeCustomerId: stripeId(checkout.customer), stripeSubscriptionId: stripeId(checkout.subscription) }).onConflictDoUpdate({ target: subscription.tenantId, set: { plan: planCode, status: "ACTIVE", stripeCustomerId: stripeId(checkout.customer), stripeSubscriptionId: stripeId(checkout.subscription) } });
        await db.update(tenant).set({ plan: planCode, updatedAt: new Date() }).where(eq(tenant.id, tenantId));
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const stripeSubscription = event.data.object;
      const tenantId = stripeSubscription.metadata.tenantId;
      const planCode = stripeSubscription.metadata.planCode;
      const values = { status: event.type === "customer.subscription.deleted" ? "CANCELED" : stripeSubscription.status.toUpperCase(), currentPeriodEndsAt: periodEnd(stripeSubscription.items.data[0]?.current_period_end), cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end, stripeCustomerId: stripeId(stripeSubscription.customer), stripeSubscriptionId: stripeSubscription.id, ...(planCode ? { plan: planCode } : {}) };
      if (tenantId) await db.update(subscription).set(values).where(eq(subscription.tenantId, tenantId));
      else await db.update(subscription).set(values).where(eq(subscription.stripeSubscriptionId, stripeSubscription.id));
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ message: "Firma de webhook inválida." }, { status: 400 });
  }
}
