import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { getKitchenBoard } from "@/server/pos/hospitality";

import { posActor } from "../../actor";

/** Comandas pendientes de cocina o barra (pantalla de la estación). */
export async function GET(request: Request) {
  try {
    const { ctx } = await posActor("pos.sell");
    const station = new URL(request.url).searchParams.get("station") === "BAR" ? "BAR" : "KITCHEN";
    return NextResponse.json(await getKitchenBoard(ctx.company.id, station));
  } catch (error) {
    return handleRouteError(error, "pos.kitchen");
  }
}
