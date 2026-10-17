import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { getOrder, updateOrder } from "@/server/pos/hospitality";

import { posActor } from "../../../actor";
import { firstIssue, updateOrderSchema } from "../../schemas";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { ctx } = await posActor("pos.sell");
    const order = await getOrder(ctx.company.id, (await params).id);
    if (!order) return jsonError(404, "Cuenta no encontrada.");
    return NextResponse.json(order);
  } catch (error) {
    return handleRouteError(error, "pos.orders.get");
  }
}

/** Comensales, camarero o nombre de la cuenta. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = updateOrderSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await updateOrder(actor, (await params).id, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.orders.update");
  }
}
