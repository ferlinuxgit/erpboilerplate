import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import * as hospitality from "@/server/pos/hospitality";

import { posActor } from "../../../../actor";
import { firstIssue, moveSchema } from "../../../schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = moveSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await hospitality.moveOrder(actor, (await params).id, parsed.data.tableId), { status: 200 });
  } catch (error) {
    return handleRouteError(error, "pos.orders.move");
  }
}
