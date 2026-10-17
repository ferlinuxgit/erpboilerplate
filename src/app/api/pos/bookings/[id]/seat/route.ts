import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { seatBooking } from "@/server/pos/bookings";

import { posActor } from "../../../actor";
import { firstIssue, seatSchema } from "../../schemas";

/** Sentar a la reserva: abre la cuenta de su mesa con sus comensales. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = seatSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await seatBooking(actor, (await params).id, { registerId: parsed.data.registerId ?? null, waiterUserId: parsed.data.waiterUserId ?? null }));
  } catch (error) {
    return handleRouteError(error, "pos.bookings.seat");
  }
}
