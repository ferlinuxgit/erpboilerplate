import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { createPortalSession } from "@/server/billing/stripe";

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const payload = (await request.json()) as { stripeCustomerId?: string };
  if (!payload.stripeCustomerId) return NextResponse.json({ message: "stripeCustomerId obligatorio." }, { status: 400 });
  const portal = await createPortalSession(payload.stripeCustomerId, `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/billing`);
  return NextResponse.json({ url: portal.url });
}
