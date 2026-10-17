import { after, NextResponse } from "next/server";

import { firstIssue, publicBookingSchema } from "@/app/api/pos/bookings/schemas";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { createPublicBooking } from "@/server/pos/bookings";

/** Reserva desde el formulario público (sin sesión). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = publicBookingSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const { notify, token, code, status, payment } = await createPublicBooking((await params).slug, parsed.data);
    after(notify);
    return NextResponse.json({ token, code, status, payment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "public.bookings.create");
  }
}
