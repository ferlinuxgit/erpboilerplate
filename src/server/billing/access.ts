import { eq } from "drizzle-orm";
import { cache } from "react";

import { company, subscription, tenant } from "@/db/schema";
import { computeBillingAccess, type BillingAccess } from "@/lib/billing/access";
import { db } from "@/lib/db";

/**
 * El cobro se aplica cuando la instalación tiene Stripe configurado (o BILLING_ENFORCED=true).
 * Sin él (desarrollo, instalaciones propias) todo está permitido. BILLING_ENFORCED=false lo apaga.
 */
export function billingEnforced() {
  const flag = process.env.BILLING_ENFORCED?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

async function loadTenantBillingAccess(tenantId: string): Promise<BillingAccess> {
  const [[row], [sub]] = await Promise.all([
    db.select({ trialEndsAt: tenant.trialEndsAt, billingExempt: tenant.billingExempt, suspendedAt: tenant.suspendedAt, suspendedReason: tenant.suspendedReason, deletionRequestedAt: tenant.deletionRequestedAt }).from(tenant).where(eq(tenant.id, tenantId)).limit(1),
    db.select({ status: subscription.status, addons: subscription.addons, pastDueSince: subscription.pastDueSince, currentPeriodEndsAt: subscription.currentPeriodEndsAt }).from(subscription).where(eq(subscription.tenantId, tenantId)).limit(1),
  ]);
  return computeBillingAccess({
    enforced: billingEnforced(),
    trialEndsAt: row?.trialEndsAt ?? null,
    billingExempt: row?.billingExempt ?? false,
    suspendedAt: row?.suspendedAt ?? null,
    suspendedReason: row?.suspendedReason ?? null,
    deletionRequestedAt: row?.deletionRequestedAt ?? null,
    subscription: sub ?? null,
  });
}

/** Acceso del espacio según su prueba y su suscripción (memoizado por petición). */
export const getTenantBillingAccess = cache(loadTenantBillingAccess);

const loadCompanyTenantId = cache(async (companyId: string) => {
  const [row] = await db.select({ tenantId: company.tenantId }).from(company).where(eq(company.id, companyId)).limit(1);
  return row?.tenantId ?? null;
});

/** Acceso del espacio al que pertenece la empresa (null si la empresa no existe). */
export async function getCompanyBillingAccess(companyId: string) {
  const tenantId = await loadCompanyTenantId(companyId);
  return tenantId ? getTenantBillingAccess(tenantId) : null;
}
