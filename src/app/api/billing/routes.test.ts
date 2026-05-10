import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSession = vi.fn();
const ensureUserTenant = vi.fn();
const openBillingCheckout = vi.fn();
const openBillingPortal = vi.fn();
const getBillingViewModelForTenant = vi.fn();

vi.mock("@/lib/current-user", () => ({ getUserSession }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant }));
vi.mock("@/server/billing/actions", () => ({ openBillingCheckout, openBillingPortal }));
vi.mock("@/server/billing/data", () => ({ getBillingViewModelForTenant }));

const session = {
  user: {
    id: "user_1",
    name: "Owner User",
    email: "owner@example.com",
  },
};

const tenantContext = {
  tenant: { id: "tenant_1", name: "Tenant", slug: "tenant" },
  company: { id: "company_1", name: "Company", baseCurrencyCode: "EUR" },
  fiscalYear: { id: "fy_1", code: "2026" },
  membership: { id: "membership_1", role: "OWNER" },
};

function jsonRequest(payload: unknown) {
  return new Request("https://erp.example.com/api/billing/test", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
}

describe("billing route handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BETTER_AUTH_URL = "https://erp.example.com/";
    getUserSession.mockResolvedValue(session);
    ensureUserTenant.mockResolvedValue(tenantContext);
  });

  it("opens checkout through audited billing action with tenant context", async () => {
    openBillingCheckout.mockResolvedValue({ url: "https://stripe.example.com/checkout" });
    const { POST } = await import("@/app/api/billing/checkout/route");

    const response = await POST(jsonRequest({ priceId: "price_business" }));

    await expect(response.json()).resolves.toEqual({ url: "https://stripe.example.com/checkout" });
    expect(response.status).toBe(200);
    expect(ensureUserTenant).toHaveBeenCalledWith({ id: "user_1", name: "Owner User" });
    expect(openBillingCheckout).toHaveBeenCalledWith({
      actor: { id: "user_1", email: "owner@example.com" },
      context: { tenantId: "tenant_1", companyId: "company_1" },
      priceId: "price_business",
      baseUrl: "https://erp.example.com/",
    });
  });

  it("opens customer portal with the persisted tenant Stripe customer and ignores client-supplied ids", async () => {
    getBillingViewModelForTenant.mockResolvedValue({
      portal: { enabled: true, stripeCustomerId: "cus_owned" },
    });
    openBillingPortal.mockResolvedValue({ url: "https://stripe.example.com/portal" });
    const { POST } = await import("@/app/api/billing/portal/route");

    const response = await POST(jsonRequest({ stripeCustomerId: "cus_attacker" }));

    await expect(response.json()).resolves.toEqual({ url: "https://stripe.example.com/portal" });
    expect(response.status).toBe(200);
    expect(ensureUserTenant).toHaveBeenCalledWith({ id: "user_1", name: "Owner User" });
    expect(getBillingViewModelForTenant).toHaveBeenCalledWith("tenant_1");
    expect(openBillingPortal).toHaveBeenCalledWith({
      actor: { id: "user_1", email: "owner@example.com" },
      context: { tenantId: "tenant_1", companyId: "company_1" },
      stripeCustomerId: "cus_owned",
      baseUrl: "https://erp.example.com/",
    });
  });

  it("rejects billing portal access when the tenant has no persisted Stripe customer", async () => {
    getBillingViewModelForTenant.mockResolvedValue({
      portal: { enabled: false, stripeCustomerId: null },
    });
    const { POST } = await import("@/app/api/billing/portal/route");

    const response = await POST(jsonRequest({ stripeCustomerId: "cus_attacker" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: "No hay cliente de facturación configurado." });
    expect(openBillingPortal).not.toHaveBeenCalled();
  });
});
