import { eq } from "drizzle-orm";

import { subscription } from "@/db/schema";
import { BASE_PLAN, MODULE_MONTHLY_CENTS, OCR_PACKS, monthlyTotalCents, isPaidModule } from "@/lib/billing/catalog";
import { db } from "@/lib/db";
import { MODULES, type ModuleId } from "@/modules/registry";
import { billingEnforced, getTenantBillingAccess } from "@/server/billing/access";
import { getOcrCreditBalance, listOcrCreditMovements } from "@/server/billing/credits";
import { stripe } from "@/server/billing/stripe";
import { listModuleStates } from "@/server/modules/service";

/** Todo lo que muestra la página de Facturación: estado, plan, módulos con precio y créditos. */
export async function getBillingOverview(tenantId: string, companyId: string) {
  const [access, [sub], balance, movements, moduleStates] = await Promise.all([
    getTenantBillingAccess(tenantId),
    db.select().from(subscription).where(eq(subscription.tenantId, tenantId)).limit(1),
    getOcrCreditBalance(tenantId),
    listOcrCreditMovements(tenantId, 15),
    listModuleStates(companyId),
  ]);
  const contracted = new Set((sub?.addons ?? []).filter(isPaidModule));
  const live = Boolean(sub?.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status));
  const modules = MODULES.map((manifest) => {
    const state = moduleStates.find((entry) => entry.id === manifest.id);
    return {
      id: manifest.id as ModuleId,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      dependsOn: manifest.dependsOn ?? [],
      priceCents: MODULE_MONTHLY_CENTS[manifest.id],
      contracted: contracted.has(manifest.id),
      selected: Boolean(state?.selected),
    };
  });
  return {
    access: {
      state: access.state,
      readOnly: access.readOnly,
      message: access.message,
      trialEndsAt: access.trialEndsAt?.toISOString() ?? null,
      graceEndsAt: access.graceEndsAt?.toISOString() ?? null,
    },
    enforced: billingEnforced(),
    stripeConfigured: Boolean(stripe),
    base: { name: BASE_PLAN.name, priceCents: BASE_PLAN.monthlyCents, features: [...BASE_PLAN.features], description: BASE_PLAN.description },
    subscription: sub
      ? {
          live,
          status: sub.status,
          currentPeriodEndsAt: sub.currentPeriodEndsAt?.toISOString() ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          hasCustomer: Boolean(sub.stripeCustomerId),
        }
      : null,
    modules,
    monthlyTotalCents: live ? monthlyTotalCents([...contracted]) : null,
    credits: {
      balance,
      packs: OCR_PACKS.map((pack) => ({ ...pack })),
      movements: movements.map((movement) => ({ ...movement, createdAt: movement.createdAt.toISOString() })),
    },
  };
}

export type BillingOverview = Awaited<ReturnType<typeof getBillingOverview>>;
