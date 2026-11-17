import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { getKitchenBoard, getRecentlyServed } from "@/server/pos/hospitality";

import { posActor } from "../../actor";

/** Comandas pendientes de cocina o barra (pantalla de la estación); `served=1`: las retiradas hace poco. */
export async function GET(request: Request) {
  try {
    const { ctx } = await posActor("pos.sell");
    const params = new URL(request.url).searchParams;
    const station = params.get("station") === "BAR" ? "BAR" : "KITCHEN";
    return NextResponse.json(params.get("served") === "1" ? await getRecentlyServed(ctx.company.id, station) : await getKitchenBoard(ctx.company.id, station));
  } catch (error) {
    return handleRouteError(error, "pos.kitchen");
  }
}
