import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { saveModifierGroup } from "@/server/pos/ordering";

import { posActor } from "../../actor";
import { firstIssue, modifierGroupSchema } from "../schemas";

export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = modifierGroupSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveModifierGroup(actor, null, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.modifiers.create");
  }
}
