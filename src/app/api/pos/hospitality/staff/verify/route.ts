import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import * as hospitality from "@/server/pos/hospitality";

import { posActor } from "../../../actor";
import { firstIssue, verifySchema } from "../../schemas";

export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = verifySchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const staff = await hospitality.verifyStaffPin(actor.companyId, parsed.data.pin);
    if (!staff) return jsonError(404, "PIN incorrecto.");
    return NextResponse.json(staff);
  } catch (error) {
    return handleRouteError(error, "pos.staff.verify");
  }
}
