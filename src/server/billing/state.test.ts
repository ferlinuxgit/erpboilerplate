import { describe, expect, it } from "vitest";

import { buildBillingViewModel } from "@/server/billing/state";

describe("billing view model", () => {
  it("disables checkout with a clear configuration error when no Stripe price ID is configured", () => {
    const viewModel = buildBillingViewModel({
      tenant: { plan: "free" },
      subscription: null,
      plan: null,
      defaultStripePriceId: undefined,
    });

    expect(viewModel.checkout.enabled).toBe(false);
    expect(viewModel.checkout.priceId).toBeNull();
    expect(viewModel.checkout.configurationError).toBe("Configura un Stripe Price ID para activar el checkout.");
    expect(JSON.stringify(viewModel)).not.toContain("price_placeholder");
  });

  it("uses persisted plan, subscription customer, renewal and limit data for actions and display", () => {
    const renewalDate = new Date("2026-06-01T00:00:00.000Z");
    const viewModel = buildBillingViewModel({
      tenant: { plan: "pro" },
      subscription: {
        plan: "business",
        status: "ACTIVE",
        currentPeriodEndsAt: renewalDate,
        stripeCustomerId: "cus_123",
        cancelAtPeriodEnd: true,
      },
      plan: {
        code: "business",
        name: "Business",
        stripePriceId: "price_business",
        limits: "10 usuarios · 10.000 documentos/mes",
      },
      defaultStripePriceId: "price_default",
    });

    expect(viewModel.plan.code).toBe("business");
    expect(viewModel.plan.name).toBe("Business");
    expect(viewModel.subscription.statusLabel).toBe("ACTIVE");
    expect(viewModel.subscription.renewalLabel).toBe("Cancela al final del periodo: 01/06/2026");
    expect(viewModel.plan.limits).toBe("10 usuarios · 10.000 documentos/mes");
    expect(viewModel.checkout).toMatchObject({ enabled: true, priceId: "price_business", configurationError: null });
    expect(viewModel.portal).toMatchObject({ enabled: true, stripeCustomerId: "cus_123" });
  });
});
