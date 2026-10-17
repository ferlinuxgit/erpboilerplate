import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe con las claves del propio restaurante (no las de la suscripción del ERP): sesión de pago
 * (Checkout), consulta, reembolso y verificación de la firma de los webhooks. Sin SDK: API REST.
 */

const API = "https://api.stripe.com/v1";

function form(data: Record<string, string | number | undefined>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) if (value !== undefined) body.append(key, String(value));
  return body;
}

async function call<T>(secretKey: string, method: "GET" | "POST", path: string, data?: Record<string, string | number | undefined>): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secretKey}`, ...(data ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: data ? form(data) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`Stripe: ${body.error?.message ?? `error ${response.status}`}`);
  return body;
}

export type StripeSession = { id: string; url: string | null; status: string; payment_status: string; payment_intent: string | null; amount_total: number | null; metadata?: Record<string, string> };

export function createCheckoutSession(secretKey: string, input: { amountCents: number; currency: string; description: string; successUrl: string; cancelUrl: string; customerEmail: string | null; expiresAt: Date; metadata: Record<string, string> }) {
  return call<StripeSession>(secretKey, "POST", "/checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": input.amountCents,
    "line_items[0][price_data][product_data][name]": input.description.slice(0, 250),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail ?? undefined,
    // Stripe exige al menos 30 minutos de validez.
    expires_at: Math.max(Math.floor(input.expiresAt.getTime() / 1000), Math.floor(Date.now() / 1000) + 31 * 60),
    locale: "es",
    ...Object.fromEntries(Object.entries(input.metadata).flatMap(([key, value]) => [[`metadata[${key}]`, value], [`payment_intent_data[metadata][${key}]`, value]])),
  });
}

export function retrieveCheckoutSession(secretKey: string, sessionId: string) {
  return call<StripeSession>(secretKey, "GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export function refundPayment(secretKey: string, paymentIntentId: string, amountCents?: number) {
  return call<{ id: string; status: string }>(secretKey, "POST", "/refunds", { payment_intent: paymentIntentId, amount: amountCents });
}

/** Comprobar que la clave funciona. */
export function stripeAccountCheck(secretKey: string) {
  return call<{ available: unknown[] }>(secretKey, "GET", "/balance");
}

/**
 * Verifica la cabecera Stripe-Signature (t=…,v1=…): HMAC-SHA256 de "t.cuerpo" con el secreto del
 * webhook y como mucho 5 minutos de antigüedad. Devuelve el evento o null.
 */
export function verifyStripeWebhook(payload: string, header: string | null, webhookSecret: string, now = Date.now()) {
  if (!header) return null;
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  const signatures = header.split(",").filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  if (Math.abs(now / 1000 - timestamp) > 300) return null;
  const expected = Buffer.from(createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex"));
  const valid = signatures.some((signature) => {
    const received = Buffer.from(signature);
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
  if (!valid) return null;
  try {
    return JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
  } catch {
    return null;
  }
}
