import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { deleteTrainingOrders } from "@/server/pos/hospitality";

import { posActor } from "../../actor";

/** Borra las cuentas de práctica del modo formación. */
export async function DELETE() {
  try {
    const { actor } = await posActor("pos.sell");
    return NextResponse.json(await deleteTrainingOrders(actor));
  } catch (error) {
    return handleRouteError(error, "pos.training.clear");
  }
}
