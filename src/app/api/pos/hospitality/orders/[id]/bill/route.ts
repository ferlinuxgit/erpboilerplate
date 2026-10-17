import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requestBill } from "@/server/pos/hospitality";

import { posActor } from "../../../../actor";

/** Pide la cuenta (pre-cuenta). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    return NextResponse.json(await requestBill(actor, (await params).id));
  } catch (error) {
    return handleRouteError(error, "pos.orders.bill");
  }
}
