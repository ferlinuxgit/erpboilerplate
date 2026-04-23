import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { createCheckoutSession } from "@/server/billing/stripe";

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const payload = (await request.json()) as { priceId?: string };
  if (!payload.priceId) return NextResponse.json({ message: "priceId obligatorio." }, { status: 400 });
  const checkout = await createCheckoutSession({
    customerEmail: session.user.email,
    priceId: payload.priceId,
    successUrl: `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/billing`,
    cancelUrl: `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/billing`,
  });
  return NextResponse.json({ url: checkout.url });
}
