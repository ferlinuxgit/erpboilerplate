import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { getFloor } from "@/server/pos/hospitality";

import { posActor } from "../../actor";

/** Plano: salas, mesas y cuenta abierta de cada una (se consulta cada pocos segundos). */
export async function GET(request: Request) {
  try {
    const { ctx } = await posActor("pos.sell");
    const params = new URL(request.url).searchParams;
    const registerId = params.get("registerId");
    if (!registerId) return jsonError(400, "Indica la caja.");
    return NextResponse.json(await getFloor(ctx.company.id, registerId, params.get("training") === "1"));
  } catch (error) {
    return handleRouteError(error, "pos.floor");
  }
}
