import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { saveAreaLayout } from "@/server/pos/hospitality";

import { posActor } from "../../../../actor";
import { firstIssue, layoutSchema } from "../../../schemas";

/** Guarda el plano de la sala (posición, tamaño y forma de sus mesas). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = layoutSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveAreaLayout(actor, (await params).id, parsed.data.tables));
  } catch (error) {
    return handleRouteError(error, "pos.areas.layout");
  }
}
