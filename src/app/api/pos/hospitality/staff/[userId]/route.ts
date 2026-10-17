import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { setStaffPin } from "@/server/pos/hospitality";

import { posActor } from "../../../actor";
import { firstIssue, pinSchema } from "../../schemas";

/** Pone o quita el PIN de camarero de una persona del equipo. */
export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = pinSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    await setStaffPin(actor, (await params).userId, parsed.data.pin || null);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, "pos.staff.pin");
  }
}
