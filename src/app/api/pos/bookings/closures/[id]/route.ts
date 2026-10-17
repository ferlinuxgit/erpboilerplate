import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { deleteBookingClosure } from "@/server/pos/bookings";

import { posActor } from "../../../actor";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.manage");
    await deleteBookingClosure(actor, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, "pos.bookings.closures.delete");
  }
}
