import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { deleteArea, updateArea } from "@/server/pos/hospitality";

import { posActor } from "../../../actor";
import { areaUpdateSchema, firstIssue } from "../../schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = areaUpdateSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await updateArea(actor, (await params).id, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.areas.update");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    await deleteArea(actor, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, "pos.areas.delete");
  }
}
