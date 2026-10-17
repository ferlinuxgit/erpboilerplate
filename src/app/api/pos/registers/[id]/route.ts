import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { updateRegister } from "@/server/pos/service";

import { posActor } from "../../actor";
import { firstIssue, registerSchema } from "../../schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = registerSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await updateRegister(actor, (await params).id, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.registers.update");
  }
}
