import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import * as hospitality from "@/server/pos/hospitality";

import { posActor } from "../../actor";
import { firstIssue, openOrderSchema } from "../schemas";

/** Abre la cuenta de una mesa (o devuelve la abierta) o una cuenta sin mesa. */
export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = openOrderSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await hospitality.openOrder(actor, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.orders.open");
  }
}
