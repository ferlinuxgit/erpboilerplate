import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { saveMenuSettings } from "@/server/pos/menu";

import { posActor } from "../../actor";
import { firstIssue, menuSettingsSchema } from "../schemas";

export async function PUT(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = menuSettingsSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveMenuSettings(actor, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.menu.settings");
  }
}
