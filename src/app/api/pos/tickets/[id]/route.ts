import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { getRefundableTicket } from "@/server/pos/service";

import { posActor } from "../../actor";

/** Ticket para devolverlo: líneas, unidades que quedan por devolver y cómo se cobró. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx } = await posActor("pos.sell");
    return NextResponse.json(await getRefundableTicket(ctx.company.id, (await params).id));
  } catch (error) {
    return handleRouteError(error, "pos.tickets.get");
  }
}
