import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { sendOrderToKitchen } from "@/server/pos/hospitality";

import { posActor } from "../../../../actor";

/** Envía lo pendiente a cocina y barra (una comanda por estación). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    return NextResponse.json(await sendOrderToKitchen(actor, (await params).id));
  } catch (error) {
    return handleRouteError(error, "pos.orders.send");
  }
}
