import { after, NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { createStaffBooking, listBookings } from "@/server/pos/bookings";

import { posActor } from "../actor";
import { firstIssue, staffBookingSchema } from "./schemas";

/** Reservas de un día (?date=AAAA-MM-DD). */
export async function GET(request: Request) {
  try {
    const { actor } = await posActor("pos.sell");
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError(400, "Fecha no válida.");
    return NextResponse.json(await listBookings(actor.companyId, date));
  } catch (error) {
    return handleRouteError(error, "pos.bookings.list");
  }
}

/** Reserva tomada por el personal (teléfono, sin reserva…). */
export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = staffBookingSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const { notify, ...booking } = await createStaffBooking(actor, parsed.data);
    after(notify);
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.bookings.create");
  }
}
