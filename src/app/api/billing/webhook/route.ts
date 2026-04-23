import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { stripe } from "@/server/billing/stripe";

export async function POST(request: Request) {
  if (!stripe) return NextResponse.json({ message: "Stripe no configurado." }, { status: 400 });
  const body = await request.text();
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ message: "Webhook no configurado." }, { status: 400 });
  try {
    stripe.webhooks.constructEvent(body, signature, secret);
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ message: "Firma de webhook inválida." }, { status: 400 });
  }
}
