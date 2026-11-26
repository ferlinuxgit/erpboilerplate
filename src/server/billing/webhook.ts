import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { billingPrice, ocrCreditLedger, processedStripeEvent, subscription, tenant } from "@/db/schema";
import { isPaidModule } from "@/lib/billing/catalog";
import { db, type DbClient } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Webhook de Stripe del cobro del SaaS. Idempotente (el id del evento se guarda en la misma
 * transacción que sus efectos) y tolerante al desorden (se descarta un evento más antiguo que el
 * último aplicado). La suscripción se toma tal cual la tiene Stripe: los módulos contratados son
 * sus líneas, así que cambiarlos en el portal o en el panel de Stripe también se refleja.
 *
 * Cada espacio tiene hasta dos suscripciones: la del plan base (anual) y la de los módulos
 * (mensual, metadato `kind: "modules"`). Las antiguas llevan plan y módulos juntos, al mes.
 */

export type WebhookDeps = {
  /** Crea la suscripción de módulos elegidos al contratar, cuando el plan queda activo. */
  createModulesSubscription?: (input: { tenantId: string; customerId: string; planSubscriptionId: string; modules: string[]; idempotencyKey: string }) => Promise<unknown>;
  /** Cancela la suscripción de módulos cuando termina el plan (no se cobran módulos sin plan). */
  cancelModulesSubscription?: (stripeSubscriptionId: string) => Promise<unknown>;
};

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "stale";

const LIVE_STATUSES = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function metadataValue(metadata: Stripe.Metadata | null | undefined, key: string) {
  const value = metadata?.[key]?.trim();
  return value ? value : null;
}

async function moduleIdsOf(client: DbClient, items: readonly Stripe.SubscriptionItem[]) {
  const modules: string[] = [];
  for (const item of items) {
    let code = metadataValue(item.price.metadata, "code");
    if (!code) {
      const [row] = await client.select({ code: billingPrice.code }).from(billingPrice).where(eq(billingPrice.stripePriceId, item.price.id)).limit(1);
      code = row?.code ?? null;
    }
    const moduleId = code?.startsWith("module:") ? code.slice("module:".length) : null;
    if (moduleId && isPaidModule(moduleId)) modules.push(moduleId);
  }
  return [...new Set(modules)].sort();
}

async function syncSubscription(client: DbClient, stripeSubscription: Stripe.Subscription, eventCreated: Date, deleted: boolean, deps: WebhookDeps): Promise<WebhookOutcome> {
  if (metadataValue(stripeSubscription.metadata, "kind") === "modules") return syncModulesSubscription(client, stripeSubscription, eventCreated, deleted);
  const customerId = stripeId(stripeSubscription.customer);
  const [byTenant] = metadataValue(stripeSubscription.metadata, "tenantId")
    ? await client.select().from(subscription).where(eq(subscription.tenantId, metadataValue(stripeSubscription.metadata, "tenantId")!)).for("update").limit(1)
    : [];
  const [byCustomer] = !byTenant && customerId ? await client.select().from(subscription).where(eq(subscription.stripeCustomerId, customerId)).for("update").limit(1) : [];
  const stored = byTenant ?? byCustomer ?? null;
  const tenantId = metadataValue(stripeSubscription.metadata, "tenantId") ?? stored?.tenantId ?? null;
  if (!tenantId) {
    logger.warn({ stripeSubscriptionId: stripeSubscription.id }, "billing.webhook.tenant_not_found");
    return "ignored";
  }
  const [tenantRow] = await client.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, tenantId)).limit(1);
  if (!tenantRow) return "ignored";
  if (stored?.lastStripeEventAt && stored.lastStripeEventAt > eventCreated) return "stale";

  const status = deleted ? "CANCELED" : stripeSubscription.status.toUpperCase();
  // Otra suscripción viva del mismo espacio: el final de una antigua no la pisa.
  if (stored?.stripeSubscriptionId && stored.stripeSubscriptionId !== stripeSubscription.id && LIVE_STATUSES.has(stored.status) && !LIVE_STATUSES.has(status)) {
    return "ignored";
  }

  const items = stripeSubscription.items?.data ?? [];
  const itemModules = await moduleIdsOf(client, items);
  // Con suscripción de módulos aparte, los módulos salen de ella (el plan no lleva líneas de módulo).
  const addons = stored?.stripeModulesSubscriptionId && itemModules.length === 0 ? stored.addons : itemModules;
  const periodEnd = items[0]?.current_period_end;
  const values = {
    plan: LIVE_STATUSES.has(status) ? "base" : "free",
    status,
    addons,
    stripeCustomerId: customerId,
    stripeSubscriptionId: stripeSubscription.id,
    currentPeriodEndsAt: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: deleted ? false : Boolean(stripeSubscription.cancel_at_period_end),
    pastDueSince: status === "PAST_DUE" ? (stored?.pastDueSince ?? eventCreated) : null,
    lastStripeEventAt: eventCreated,
  };
  await client.insert(subscription).values({ tenantId, ...values }).onConflictDoUpdate({ target: subscription.tenantId, set: values });
  await client.update(tenant).set({ plan: values.plan, updatedAt: new Date() }).where(eq(tenant.id, tenantId));

  // Plan terminado: se cancela también la suscripción de módulos.
  if (status === "CANCELED" && stored?.stripeModulesSubscriptionId && stored.stripeSubscriptionId === stripeSubscription.id && deps.cancelModulesSubscription) {
    await deps.cancelModulesSubscription(stored.stripeModulesSubscriptionId);
  }

  // Módulos elegidos al contratar: en cuanto el plan está activo se crea su suscripción mensual.
  const requested = (metadataValue(stripeSubscription.metadata, "modules") ?? "").split(",").filter(isPaidModule);
  if (requested.length && customerId && (status === "ACTIVE" || status === "TRIALING") && !stored?.stripeModulesSubscriptionId && deps.createModulesSubscription) {
    await deps.createModulesSubscription({ tenantId, customerId, planSubscriptionId: stripeSubscription.id, modules: requested, idempotencyKey: `modules-from-plan-${stripeSubscription.id}` });
  }
  return "processed";
}

/** Suscripción mensual de módulos: solo cambia los módulos contratados, nunca el plan. */
async function syncModulesSubscription(client: DbClient, stripeSubscription: Stripe.Subscription, eventCreated: Date, deleted: boolean): Promise<WebhookOutcome> {
  const tenantId = metadataValue(stripeSubscription.metadata, "tenantId");
  if (!tenantId) return "ignored";
  const [stored] = await client.select().from(subscription).where(eq(subscription.tenantId, tenantId)).for("update").limit(1);
  if (!stored) return "ignored";
  if (stored.modulesLastStripeEventAt && stored.modulesLastStripeEventAt > eventCreated) return "stale";
  const status = deleted ? "CANCELED" : stripeSubscription.status.toUpperCase();
  const ended = status === "CANCELED" || status === "INCOMPLETE_EXPIRED";
  // El final de una suscripción de módulos antigua no pisa la actual.
  if (stored.stripeModulesSubscriptionId && stored.stripeModulesSubscriptionId !== stripeSubscription.id && ended) return "ignored";
  const addons = LIVE_STATUSES.has(status) ? await moduleIdsOf(client, stripeSubscription.items?.data ?? []) : [];
  await client
    .update(subscription)
    .set({
      addons,
      stripeModulesSubscriptionId: ended ? null : stripeSubscription.id,
      modulesStatus: ended ? null : status,
      modulesLastStripeEventAt: eventCreated,
    })
    .where(eq(subscription.tenantId, tenantId));
  return "processed";
}

async function creditPurchase(client: DbClient, checkout: Stripe.Checkout.Session): Promise<WebhookOutcome> {
  if (checkout.payment_status !== "paid") return "ignored";
  const tenantId = metadataValue(checkout.metadata, "tenantId");
  const credits = Number(metadataValue(checkout.metadata, "credits"));
  if (!tenantId || !Number.isInteger(credits) || credits <= 0) return "ignored";
  const [tenantRow] = await client.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, tenantId)).limit(1);
  if (!tenantRow) return "ignored";
  await client
    .insert(ocrCreditLedger)
    .values({
      tenantId,
      kind: "PURCHASE",
      delta: credits,
      description: `Compra de ${credits} créditos de lectura de facturas`,
      stripeCheckoutSessionId: checkout.id,
      actorUserId: metadataValue(checkout.metadata, "actorUserId"),
    })
    .onConflictDoNothing();
  return "processed";
}

export async function handleStripeEvent(event: Stripe.Event, client: DbClient, deps: WebhookDeps = {}): Promise<WebhookOutcome> {
  const created = new Date(event.created * 1000);
  const inserted = await client.insert(processedStripeEvent).values({ id: event.id, type: event.type, stripeCreatedAt: created }).onConflictDoNothing().returning({ id: processedStripeEvent.id });
  if (inserted.length === 0) return "duplicate";

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const checkout = event.data.object;
      // La suscripción llega con sus líneas en customer.subscription.created/updated.
      if (metadataValue(checkout.metadata, "kind") === "ocr-credits") return creditPurchase(client, checkout);
      return "ignored";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return syncSubscription(client, event.data.object, created, event.type === "customer.subscription.deleted", deps);
    default:
      return "ignored";
  }
}

export async function processStripeWebhookEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  const { cancelModulesSubscription, createModulesSubscription } = await import("@/server/billing/stripe");
  return db.transaction((tx) => handleStripeEvent(event, tx, {
    createModulesSubscription: (input) => createModulesSubscription({ ...input, modules: input.modules.filter(isPaidModule) }),
    cancelModulesSubscription,
  }));
}
