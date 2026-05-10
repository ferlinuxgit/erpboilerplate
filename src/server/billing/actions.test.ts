import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

import { openBillingCheckout, openBillingPortal } from "@/server/billing/actions";

const actor = { id: "user_1", email: "owner@example.com" };
const context = { tenantId: "tenant_1", companyId: "company_1" };

describe("billing action auditing", () => {
  it("audits checkout attempts and Stripe errors before surfacing the failure", async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const createCheckoutSession = vi.fn().mockRejectedValue(new Error("Stripe API unavailable"));

    await expect(
      openBillingCheckout({
        actor,
        context,
        priceId: "price_business",
        baseUrl: "https://erp.example.com",
        audit,
        createCheckoutSession,
      }),
    ).rejects.toThrow("Stripe API unavailable");

    expect(createCheckoutSession).toHaveBeenCalledWith({
      customerEmail: "owner@example.com",
      priceId: "price_business",
      successUrl: "https://erp.example.com/billing",
      cancelUrl: "https://erp.example.com/billing",
    });
    expect(audit).toHaveBeenNthCalledWith(1, {
      tenantId: "tenant_1",
      companyId: "company_1",
      actorUserId: "user_1",
      action: "billing.checkout.attempt",
      entityName: "billingCheckout",
      entityId: "price_business",
      payload: { priceId: "price_business" },
    });
    expect(audit).toHaveBeenNthCalledWith(2, {
      tenantId: "tenant_1",
      companyId: "company_1",
      actorUserId: "user_1",
      action: "billing.checkout.error",
      entityName: "billingCheckout",
      entityId: "price_business",
      payload: { priceId: "price_business", error: "Stripe API unavailable" },
    });
  });

  it("audits portal attempts and Stripe errors before surfacing the failure", async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const createPortalSession = vi.fn().mockRejectedValue(new Error("Customer has no portal configuration"));

    await expect(
      openBillingPortal({
        actor,
        context,
        stripeCustomerId: "cus_123",
        baseUrl: "https://erp.example.com",
        audit,
        createPortalSession,
      }),
    ).rejects.toThrow("Customer has no portal configuration");

    expect(createPortalSession).toHaveBeenCalledWith("cus_123", "https://erp.example.com/billing");
    expect(audit).toHaveBeenNthCalledWith(1, {
      tenantId: "tenant_1",
      companyId: "company_1",
      actorUserId: "user_1",
      action: "billing.portal.attempt",
      entityName: "billingPortal",
      entityId: "cus_123",
      payload: { stripeCustomerId: "cus_123" },
    });
    expect(audit).toHaveBeenNthCalledWith(2, {
      tenantId: "tenant_1",
      companyId: "company_1",
      actorUserId: "user_1",
      action: "billing.portal.error",
      entityName: "billingPortal",
      entityId: "cus_123",
      payload: { stripeCustomerId: "cus_123", error: "Customer has no portal configuration" },
    });
  });
});
