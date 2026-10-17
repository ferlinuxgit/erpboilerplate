import { after, NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { changeBookingStatus } from "@/server/pos/bookings";

import { posActor } from "../../../actor";
import { firstIssue, statusSchema } from "../../schemas";

/** Confirmar, cancelar, marcar «no vino», terminar o recuperar una reserva. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = statusSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const { notify, ...result } = await changeBookingStatus(actor, (await params).id, parsed.data.action, parsed.data);
    after(notify);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "pos.bookings.status");
  }
}
