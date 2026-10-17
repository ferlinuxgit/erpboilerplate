import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import * as hospitality from "@/server/pos/hospitality";

import { posActor } from "../../../../actor";
import { firstIssue, transferSchema } from "../../../schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = transferSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await hospitality.transferLines(actor, (await params).id, parsed.data), { status: 200 });
  } catch (error) {
    return handleRouteError(error, "pos.orders.transfer");
  }
}
