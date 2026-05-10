import { eq } from "drizzle-orm";

import { plan, subscription, tenant } from "@/db/schema";
import { db } from "@/lib/db";
import { buildBillingViewModel } from "@/server/billing/state";

export async function getBillingViewModelForTenant(tenantId: string) {
  const [currentTenant] = await db
    .select({ plan: tenant.plan })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1);

  const [currentSubscription] = await db
    .select({
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      stripeCustomerId: subscription.stripeCustomerId,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    })
    .from(subscription)
    .where(eq(subscription.tenantId, tenantId))
    .limit(1);

  const planCode = currentSubscription?.plan ?? currentTenant?.plan ?? "free";
  const [currentPlan] = await db
    .select({
      code: plan.code,
      name: plan.name,
      stripePriceId: plan.stripePriceId,
      limits: plan.limits,
    })
    .from(plan)
    .where(eq(plan.code, planCode))
    .limit(1);

  return buildBillingViewModel({
    tenant: { plan: currentTenant?.plan ?? "free" },
    subscription: currentSubscription ?? null,
    plan: currentPlan ?? null,
    defaultStripePriceId: process.env.NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID,
  });
}
