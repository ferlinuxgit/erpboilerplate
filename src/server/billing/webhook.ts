import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { processedStripeEvent, subscription, tenant } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { logger } from "@/lib/logger";

export const FREE_PLAN_CODE = "free";

/** Estados de Stripe con los que el tenant conserva el plan de pago. */
const PAID_STATUSES = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);
/** Estados terminales: el tenant vuelve al plan gratuito. */
const ENDED_STATUSES = new Set(["CANCELED", "UNPAID", "INCOMPLETE_EXPIRED"]);

type SubscriptionValues = {
  plan?: string;
  status: string;
  currentPeriodEndsAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

type StoredSubscription = { tenantId: string; plan: string; lastStripeEventAt: Date | null };

export type BillingWebhookStore = {
  /** Registra el evento; `false` si ya estaba procesado (duplicado). */
  markEventProcessed(event: { id: string; type: string; created: Date }): Promise<boolean>;
  findSubscription(lookup: { tenantId?: string | null; stripeSubscriptionId?: string | null; stripeCustomerId?: string | null }): Promise<StoredSubscription | null>;
  tenantExists(tenantId: string): Promise<boolean>;
  upsertSubscription(tenantId: string, values: SubscriptionValues & { plan: string; lastStripeEventAt: Date }): Promise<void>;
  setTenantPlan(tenantId: string, plan: string): Promise<void>;
};

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "stale";

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function periodEnd(value: number | null | undefined) {
  return value ? new Date(value * 1000) : null;
}

function metadataValue(metadata: Stripe.Metadata | null | undefined, key: string) {
  const value = metadata?.[key]?.trim();
  return value ? value : null;
}

async function applySubscriptionState(
  store: BillingWebhookStore,
  input: { tenantId: string | null; eventCreated: Date; values: SubscriptionValues },
): Promise<WebhookOutcome> {
  const existing = await store.findSubscription({
    tenantId: input.tenantId,
    stripeSubscriptionId: input.values.stripeSubscriptionId,
    stripeCustomerId: input.values.stripeCustomerId,
  });
  const tenantId = input.tenantId ?? existing?.tenantId ?? null;
  if (!tenantId || !(await store.tenantExists(tenantId))) {
    logger.warn({ stripeSubscriptionId: input.values.stripeSubscriptionId }, "billing.webhook.tenant_not_found");
    return "ignored";
  }

  // Stripe no garantiza el orden: si ya aplicamos un evento posterior, este se descarta.
  if (existing?.tenantId === tenantId && existing.lastStripeEventAt && existing.lastStripeEventAt > input.eventCreated) {
    return "stale";
  }

  const plan = input.values.plan ?? existing?.plan ?? FREE_PLAN_CODE;
  await store.upsertSubscription(tenantId, { ...input.values, plan, lastStripeEventAt: input.eventCreated });

  if (ENDED_STATUSES.has(input.values.status)) await store.setTenantPlan(tenantId, FREE_PLAN_CODE);
  else if (PAID_STATUSES.has(input.values.status) && input.values.plan) await store.setTenantPlan(tenantId, input.values.plan);
  return "processed";
}

/**
 * Procesa un evento ya verificado. Idempotente: el id del evento se registra en
 * la misma transacción que sus efectos, así que un fallo permite el reintento de
 * Stripe y un duplicado no vuelve a aplicarse.
 */
export async function handleStripeEvent(event: Stripe.Event, store: BillingWebhookStore): Promise<WebhookOutcome> {
  const created = new Date(event.created * 1000);
  const isFirstDelivery = await store.markEventProcessed({ id: event.id, type: event.type, created });
  if (!isFirstDelivery) return "duplicate";

  switch (event.type) {
    case "checkout.session.completed": {
      const checkout = event.data.object;
      const tenantId = metadataValue(checkout.metadata, "tenantId") ?? checkout.client_reference_id ?? null;
      const planCode = metadataValue(checkout.metadata, "planCode");
      if (!tenantId || !planCode) return "ignored";
      return applySubscriptionState(store, {
        tenantId,
        eventCreated: created,
        values: {
          plan: planCode,
          status: "ACTIVE",
          stripeCustomerId: stripeId(checkout.customer),
          stripeSubscriptionId: stripeId(checkout.subscription),
        },
      });
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const stripeSubscription = event.data.object;
      const deleted = event.type === "customer.subscription.deleted";
      return applySubscriptionState(store, {
        tenantId: metadataValue(stripeSubscription.metadata, "tenantId"),
        eventCreated: created,
        values: {
          plan: metadataValue(stripeSubscription.metadata, "planCode") ?? undefined,
          status: deleted ? "CANCELED" : stripeSubscription.status.toUpperCase(),
          currentPeriodEndsAt: periodEnd(stripeSubscription.items?.data[0]?.current_period_end),
          cancelAtPeriodEnd: deleted ? false : stripeSubscription.cancel_at_period_end,
          stripeCustomerId: stripeId(stripeSubscription.customer),
          stripeSubscriptionId: stripeSubscription.id,
        },
      });
    }
    default:
      return "ignored";
  }
}

export function createDrizzleBillingWebhookStore(client: DbClient): BillingWebhookStore {
  return {
    async markEventProcessed(event) {
      const inserted = await client
        .insert(processedStripeEvent)
        .values({ id: event.id, type: event.type, stripeCreatedAt: event.created })
        .onConflictDoNothing()
        .returning({ id: processedStripeEvent.id });
      return inserted.length > 0;
    },
    async findSubscription(lookup) {
      const columns = { tenantId: subscription.tenantId, plan: subscription.plan, lastStripeEventAt: subscription.lastStripeEventAt };
      const candidates = [
        lookup.tenantId ? eq(subscription.tenantId, lookup.tenantId) : null,
        lookup.stripeSubscriptionId ? eq(subscription.stripeSubscriptionId, lookup.stripeSubscriptionId) : null,
        lookup.stripeCustomerId ? eq(subscription.stripeCustomerId, lookup.stripeCustomerId) : null,
      ];
      for (const condition of candidates) {
        if (!condition) continue;
        const [row] = await client.select(columns).from(subscription).where(condition).for("update").limit(1);
        if (row) return row;
      }
      return null;
    },
    async tenantExists(tenantId) {
      const [row] = await client.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, tenantId)).limit(1);
      return Boolean(row);
    },
    async upsertSubscription(tenantId, values) {
      const set = {
        plan: values.plan,
        status: values.status,
        lastStripeEventAt: values.lastStripeEventAt,
        ...(values.currentPeriodEndsAt !== undefined ? { currentPeriodEndsAt: values.currentPeriodEndsAt } : {}),
        ...(values.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: values.cancelAtPeriodEnd } : {}),
        ...(values.stripeCustomerId ? { stripeCustomerId: values.stripeCustomerId } : {}),
        ...(values.stripeSubscriptionId ? { stripeSubscriptionId: values.stripeSubscriptionId } : {}),
      };
      await client
        .insert(subscription)
        .values({ tenantId, ...set })
        .onConflictDoUpdate({ target: subscription.tenantId, set });
    },
    async setTenantPlan(tenantId, plan) {
      await client.update(tenant).set({ plan, updatedAt: new Date() }).where(eq(tenant.id, tenantId));
    },
  };
}

export async function processStripeWebhookEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  return db.transaction((tx) => handleStripeEvent(event, createDrizzleBillingWebhookStore(tx)));
}
