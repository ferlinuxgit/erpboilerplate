import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { deleteSetMenu, saveSetMenu } from "@/server/pos/ordering";

import { posActor } from "../../../actor";
import { firstIssue, setMenuSchema } from "../../schemas";

type Params = { params: Promise<{ itemId: string }> };

/** Tiempos y platos a elegir de un menú de precio cerrado. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = setMenuSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveSetMenu(actor, (await params).itemId, parsed.data.courses));
  } catch (error) {
    return handleRouteError(error, "pos.set_menus.save");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    await deleteSetMenu(actor, (await params).itemId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, "pos.set_menus.delete");
  }
}
