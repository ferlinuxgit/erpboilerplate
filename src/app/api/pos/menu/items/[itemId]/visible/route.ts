import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { setMenuItemVisible } from "@/server/pos/menu";

import { posActor } from "../../../../actor";
import { firstIssue, visibleSchema } from "../../../schemas";

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = visibleSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await setMenuItemVisible(actor, (await params).itemId, parsed.data.visible));
  } catch (error) {
    return handleRouteError(error, "pos.menu.items.visible");
  }
}
