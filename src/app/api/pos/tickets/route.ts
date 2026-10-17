import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { findTickets } from "@/server/pos/service";

import { posActor } from "../actor";

/** Busca tickets por número (devoluciones de otros días). */
export async function GET(request: Request) {
  try {
    const { ctx } = await posActor("pos.sell");
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) return NextResponse.json([]);
    return NextResponse.json(await findTickets(ctx.company.id, query));
  } catch (error) {
    return handleRouteError(error, "pos.tickets.find");
  }
}
