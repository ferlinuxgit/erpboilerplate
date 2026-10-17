import { after, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { notifyNewBooking } from "@/server/pos/bookings";
import { handleStripeWebhook } from "@/server/pos/deposits";

/** Webhook de Stripe del restaurante (firmado con su secreto): fianza pagada. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await params;
    const payload = await request.text();
    const result = await handleStripeWebhook(companyId, payload, request.headers.get("stripe-signature"));
    if (result.notify && result.bookingId) after(() => notifyNewBooking(companyId, result.bookingId!));
    return NextResponse.json({ received: true });
  } catch (error) {
    return handleRouteError(error, "public.payments.stripe");
  }
}
