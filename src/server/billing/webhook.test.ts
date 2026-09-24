import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { handleStripeEvent, type BillingWebhookStore } from "@/server/billing/webhook";

type Row = { tenantId: string; plan: string; status: string; stripeSubscriptionId: string | null; stripeCustomerId: string | null; lastStripeEventAt: Date };

function memoryStore(tenants = ["tenant_1"]) {
  const processed = new Set<string>();
  const subscriptions = new Map<string, Row>();
  const tenantPlans = new Map(tenants.map((id) => [id, "free"]));
  const store: BillingWebhookStore = {
    async markEventProcessed(event) {
      if (processed.has(event.id)) return false;
      processed.add(event.id);
      return true;
    },
    async findSubscription(lookup) {
      for (const row of subscriptions.values()) {
        if (row.tenantId === lookup.tenantId || (lookup.stripeSubscriptionId && row.stripeSubscriptionId === lookup.stripeSubscriptionId) || (lookup.stripeCustomerId && row.stripeCustomerId === lookup.stripeCustomerId)) return row;
      }
      return null;
    },
    async tenantExists(tenantId) {
      return tenantPlans.has(tenantId);
    },
    async upsertSubscription(tenantId, values) {
      const current = subscriptions.get(tenantId);
      subscriptions.set(tenantId, {
        tenantId,
        plan: values.plan,
        status: values.status,
        stripeSubscriptionId: values.stripeSubscriptionId ?? current?.stripeSubscriptionId ?? null,
        stripeCustomerId: values.stripeCustomerId ?? current?.stripeCustomerId ?? null,
        lastStripeEventAt: values.lastStripeEventAt,
      });
    },
    async setTenantPlan(tenantId, plan) {
      tenantPlans.set(tenantId, plan);
    },
  };
  return { store, subscriptions, tenantPlans };
}

function subscriptionEvent(id: string, type: string, created: number, overrides: Partial<{ status: string; metadata: Record<string, string> }> = {}) {
  return {
    id,
    type,
    created,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: overrides.status ?? "active",
        cancel_at_period_end: false,
        metadata: overrides.metadata ?? { tenantId: "tenant_1", planCode: "business" },
        items: { data: [{ current_period_end: created + 30 * 86_400 }] },
      },
    },
  } as unknown as Stripe.Event;
}

function checkoutEvent(id: string, created: number) {
  return {
    id,
    type: "checkout.session.completed",
    created,
    data: { object: { metadata: { tenantId: "tenant_1", planCode: "business" }, client_reference_id: "tenant_1", customer: "cus_1", subscription: "sub_1" } },
  } as unknown as Stripe.Event;
}

describe("Stripe webhook processing", () => {
  it("processes an event only once (dedupe by event id)", async () => {
    const { store, tenantPlans } = memoryStore();
    const setTenantPlan = vi.spyOn(store, "setTenantPlan");

    await expect(handleStripeEvent(checkoutEvent("evt_1", 1_000), store)).resolves.toBe("processed");
    await expect(handleStripeEvent(checkoutEvent("evt_1", 1_000), store)).resolves.toBe("duplicate");

    expect(setTenantPlan).toHaveBeenCalledTimes(1);
    expect(tenantPlans.get("tenant_1")).toBe("business");
  });

  it("ignores subscription events that arrive out of order", async () => {
    const { store, subscriptions, tenantPlans } = memoryStore();

    await handleStripeEvent(subscriptionEvent("evt_new", "customer.subscription.deleted", 2_000), store);
    const outcome = await handleStripeEvent(subscriptionEvent("evt_old", "customer.subscription.updated", 1_000, { status: "active" }), store);

    expect(outcome).toBe("stale");
    expect(subscriptions.get("tenant_1")?.status).toBe("CANCELED");
    expect(tenantPlans.get("tenant_1")).toBe("free");
  });

  it("resets the tenant plan to free when the subscription is deleted", async () => {
    const { store, subscriptions, tenantPlans } = memoryStore();

    await handleStripeEvent(checkoutEvent("evt_checkout", 1_000), store);
    expect(tenantPlans.get("tenant_1")).toBe("business");
    await handleStripeEvent(subscriptionEvent("evt_deleted", "customer.subscription.deleted", 3_000, { metadata: {} }), store);

    // Sin metadata, la suscripción se resuelve por su id de Stripe.
    expect(subscriptions.get("tenant_1")).toMatchObject({ status: "CANCELED", plan: "business" });
    expect(tenantPlans.get("tenant_1")).toBe("free");
  });

  it("upgrades on active updates and ignores events for unknown tenants", async () => {
    const { store, tenantPlans } = memoryStore();

    await expect(handleStripeEvent(subscriptionEvent("evt_upd", "customer.subscription.updated", 1_000), store)).resolves.toBe("processed");
    expect(tenantPlans.get("tenant_1")).toBe("business");

    const foreign = subscriptionEvent("evt_foreign", "customer.subscription.updated", 1_500, { metadata: { tenantId: "tenant_404", planCode: "business" } });
    (foreign.data.object as { id: string }).id = "sub_other";
    (foreign.data.object as { customer: string }).customer = "cus_other";
    await expect(handleStripeEvent(foreign, store)).resolves.toBe("ignored");
  });

  it("propagates processing errors so the route can answer 500 and Stripe retries", async () => {
    const { store } = memoryStore();
    store.upsertSubscription = vi.fn().mockRejectedValue(new Error("db down"));

    await expect(handleStripeEvent(checkoutEvent("evt_fail", 1_000), store)).rejects.toThrow("db down");
  });
});
