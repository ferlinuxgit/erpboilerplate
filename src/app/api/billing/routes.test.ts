import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSession = vi.fn();
const ensureUserTenant = vi.fn();
const recordAudit = vi.fn();
const stripeMocks = vi.hoisted(() => ({
  ensureStripeCustomer: vi.fn(),
  createSubscriptionCheckout: vi.fn(),
  createCreditsCheckout: vi.fn(),
  createPortalSession: vi.fn(),
  updateSubscriptionModules: vi.fn(),
}));
const dbRows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/lib/current-user", () => ({ getUserSession }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant }));
vi.mock("@/server/audit", () => ({ recordAudit }));
vi.mock("@/server/billing/stripe", () => stripeMocks);
vi.mock("@/server/modules/service", () => ({ setCompanyModule: vi.fn(async () => []) }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const chain = { from: vi.fn(() => chain), where: vi.fn(() => chain), limit: vi.fn(async () => dbRows.current) };
      return chain;
    }),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  },
}));

const owner = { user: { id: "user_1", name: "Owner User", email: "owner@example.com" } };
const context = (role = "OWNER") => ({
  tenant: { id: "tenant_1", name: "Tenant", slug: "tenant" },
  company: { id: "company_1", name: "Company", baseCurrencyCode: "EUR" },
  fiscalYear: { id: "fy_1", code: "2026" },
  membership: { id: "membership_1", role },
});

const post = (payload: unknown) => new Request("https://erp.example.com/api/billing/test", { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });

describe("rutas de cobro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://erp.example.com/";
    getUserSession.mockResolvedValue(owner);
    ensureUserTenant.mockResolvedValue(context());
    dbRows.current = [];
    stripeMocks.ensureStripeCustomer.mockResolvedValue("cus_1");
  });

  it("contratar: plan base + módulos válidos, con el cliente del espacio y vuelta a /billing", async () => {
    stripeMocks.createSubscriptionCheckout.mockResolvedValue({ id: "cs_1", url: "https://stripe.example.com/cs_1" });
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(post({ modules: ["pos", "hospitality"] }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://stripe.example.com/cs_1" });
    expect(stripeMocks.createSubscriptionCheckout).toHaveBeenCalledWith({ tenantId: "tenant_1", customerId: "cus_1", modules: ["pos", "hospitality"], returnUrl: "https://erp.example.com/billing" });
  });

  it("no deja contratar dos veces, ni módulos sin sus dependencias o inexistentes", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    expect((await POST(post({ modules: ["hospitality"] }))).status).toBe(400);
    expect((await POST(post({ modules: ["inventado"] }))).status).toBe(400);
    dbRows.current = [{ status: "ACTIVE", stripeSubscriptionId: "sub_1" }];
    expect((await POST(post({ modules: [] }))).status).toBe(409);
    expect(stripeMocks.createSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it("solo el propietario contrata", async () => {
    ensureUserTenant.mockResolvedValue(context("MEMBER"));
    const { POST } = await import("@/app/api/billing/checkout/route");
    expect((await POST(post({ modules: [] }))).status).toBe(403);
  });

  it("cambiar módulos necesita una suscripción en curso y la actualiza en Stripe", async () => {
    const { POST } = await import("@/app/api/billing/modules/route");
    expect((await POST(post({ modules: ["crm"] }))).status).toBe(409);
    dbRows.current = [{ status: "ACTIVE", addons: [], stripeSubscriptionId: "sub_1" }];
    const response = await POST(post({ modules: ["crm"] }));
    expect(response.status).toBe(200);
    expect(stripeMocks.updateSubscriptionModules).toHaveBeenCalledWith({ stripeSubscriptionId: "sub_1", modules: ["crm"] });
  });

  it("comprar créditos abre el pago del pack elegido", async () => {
    stripeMocks.createCreditsCheckout.mockResolvedValue({ id: "cs_2", url: "https://stripe.example.com/cs_2" });
    const { POST } = await import("@/app/api/billing/credits/route");
    const response = await POST(post({ packCode: "ocr-500" }));
    expect(response.status).toBe(200);
    expect(stripeMocks.createCreditsCheckout).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant_1", customerId: "cus_1", packCode: "ocr-500" }));
  });

  it("el portal usa el cliente guardado del espacio y sin cliente responde 400", async () => {
    const { POST } = await import("@/app/api/billing/portal/route");
    expect((await POST()).status).toBe(400);
    dbRows.current = [{ stripeCustomerId: "cus_owned" }];
    stripeMocks.createPortalSession.mockResolvedValue({ url: "https://stripe.example.com/portal" });
    const response = await POST();
    await expect(response.json()).resolves.toEqual({ url: "https://stripe.example.com/portal" });
    expect(stripeMocks.createPortalSession).toHaveBeenCalledWith("cus_owned", "https://erp.example.com/billing");
  });
});
