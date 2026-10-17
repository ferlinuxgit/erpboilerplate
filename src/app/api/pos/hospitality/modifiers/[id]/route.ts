import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { deleteModifierGroup, saveModifierGroup } from "@/server/pos/ordering";

import { posActor } from "../../../actor";
import { firstIssue, modifierGroupSchema } from "../../schemas";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = modifierGroupSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveModifierGroup(actor, (await params).id, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.modifiers.update");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    await deleteModifierGroup(actor, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, "pos.modifiers.delete");
  }
}
