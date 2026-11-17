import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { getHospitalitySettings, saveHospitalitySettings } from "@/server/pos/hospitality";

import { posActor } from "../../actor";
import { firstIssue, hospitalitySettingsSchema } from "../schemas";

/** Reglas de la sala (autorización del encargado). */
export async function GET() {
  try {
    const { ctx } = await posActor("pos.sell");
    return NextResponse.json(await getHospitalitySettings(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "pos.hospitality.settings");
  }
}

export async function PUT(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = hospitalitySettingsSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveHospitalitySettings(actor, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.hospitality.settings");
  }
}
