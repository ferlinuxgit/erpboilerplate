import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { fireNextCourse } from "@/server/pos/hospitality";

import { posActor } from "../../../../actor";

/** «Marchar»: cocina empieza el siguiente tiempo en espera. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    return NextResponse.json(await fireNextCourse(actor, (await params).id));
  } catch (error) {
    return handleRouteError(error, "pos.orders.fire");
  }
}
