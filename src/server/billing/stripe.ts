import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export async function createCheckoutSession(input: { customerEmail: string; priceId: string; successUrl: string; cancelUrl: string }) {
  if (!stripe) throw new Error("Stripe no está configurado.");
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: input.customerEmail,
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
}

export async function createPortalSession(customerId: string, returnUrl: string) {
  if (!stripe) throw new Error("Stripe no está configurado.");
  return stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
}
