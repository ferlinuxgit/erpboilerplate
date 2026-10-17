import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { getPublicAvailability } from "@/server/pos/bookings";

/** Horas disponibles de un día para un grupo (?date, ?party). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const search = new URL(request.url).searchParams;
    const party = Number(search.get("party"));
    const date = search.get("date") ?? "";
    if (!Number.isInteger(party) || party < 1 || party > 100) return jsonError(400, "Número de personas no válido.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError(400, "Fecha no válida.");
    return NextResponse.json(await getPublicAvailability((await params).slug, date, party), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "public.bookings.availability");
  }
}
