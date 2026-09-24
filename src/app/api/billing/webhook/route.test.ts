import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructEvent, processStripeWebhookEvent } = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  processStripeWebhookEvent: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "stripe-signature": "t=1,v1=abc" }) }));
vi.mock("@/server/billing/stripe", () => ({ stripe: { webhooks: { constructEvent } } }));
vi.mock("@/server/billing/webhook", () => ({ processStripeWebhookEvent }));

function webhookRequest() {
  return new Request("https://erp.example.com/api/billing/webhook", { method: "POST", body: "{}" });
}

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  it("answers 400 for invalid signatures without processing", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("No signatures found");
    });
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: "Firma de webhook inválida." });
    expect(processStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("answers 500 (so Stripe retries) when processing fails after a valid signature", async () => {
    constructEvent.mockReturnValue({ id: "evt_1", type: "customer.subscription.updated" });
    processStripeWebhookEvent.mockRejectedValue(new Error("db down"));
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ message: "No se pudo procesar el evento." });
  });

  it("acknowledges processed and duplicate events", async () => {
    constructEvent.mockReturnValue({ id: "evt_1", type: "checkout.session.completed" });
    processStripeWebhookEvent.mockResolvedValue("duplicate");
    const { POST } = await import("@/app/api/billing/webhook/route");

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, outcome: "duplicate" });
  });
});
