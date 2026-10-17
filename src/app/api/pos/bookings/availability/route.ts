import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { getStaffAvailability } from "@/server/pos/bookings";

import { posActor } from "../../actor";

/** Horas libres para el formulario del personal (?date, ?party, ?ignore=<reserva que se edita>). */
export async function GET(request: Request) {
  try {
    const { actor } = await posActor("pos.sell");
    const params = new URL(request.url).searchParams;
    const party = Number(params.get("party"));
    if (!Number.isInteger(party) || party < 1 || party > 500) return jsonError(400, "Número de personas no válido.");
    return NextResponse.json(await getStaffAvailability(actor.companyId, params.get("date") ?? "", party, params.get("ignore") ?? undefined));
  } catch (error) {
    return handleRouteError(error, "pos.bookings.availability");
  }
}
