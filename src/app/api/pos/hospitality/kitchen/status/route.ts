import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import * as hospitality from "@/server/pos/hospitality";

import { posActor } from "../../../actor";
import { firstIssue, kitchenStatusSchema } from "../../schemas";

export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = kitchenStatusSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await hospitality.setKitchenLineStatus(actor, parsed.data.lineIds, parsed.data.status), { status: 200 });
  } catch (error) {
    return handleRouteError(error, "pos.kitchen.status");
  }
}
