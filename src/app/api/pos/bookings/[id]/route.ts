import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { updateStaffBooking } from "@/server/pos/bookings";

import { posActor } from "../../actor";
import { firstIssue, staffBookingUpdateSchema } from "../schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = staffBookingUpdateSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await updateStaffBooking(actor, (await params).id, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.bookings.update");
  }
}
