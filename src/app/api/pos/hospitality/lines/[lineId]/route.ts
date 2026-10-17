import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { updateOrderLine } from "@/server/pos/hospitality";

import { posActor } from "../../../actor";
import { firstIssue, updateLineSchema } from "../../schemas";

/** Unidades o nota de una línea (si ya está en cocina, solo anular con motivo). */
export async function PATCH(request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = updateLineSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await updateOrderLine(actor, (await params).lineId, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.orders.line");
  }
}
