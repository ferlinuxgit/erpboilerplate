import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { stripe } from "@/server/billing/stripe";
import { processStripeWebhookEvent } from "@/server/billing/webhook";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    logger.error("billing.webhook.not_configured");
    return jsonError(503, "Webhook de Stripe no configurado.");
  }
  const signature = (await headers()).get("stripe-signature");
  if (!signature) return jsonError(400, "Falta la firma del webhook.");

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    logger.warn({ err: error }, "billing.webhook.invalid_signature");
    return jsonError(400, "Firma de webhook inválida.");
  }

  try {
    const outcome = await processStripeWebhookEvent(event);
    logger.info({ eventId: event.id, type: event.type, outcome }, "billing.webhook.handled");
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    // 500 → Stripe reintenta; el evento no quedó marcado porque la transacción se revirtió.
    logger.error({ err: error, eventId: event.id, type: event.type }, "billing.webhook.processing_failed");
    return jsonError(500, "No se pudo procesar el evento.");
  }
}
