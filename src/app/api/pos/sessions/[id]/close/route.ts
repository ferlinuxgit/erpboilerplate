import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { closeSession } from "@/server/pos/service";

import { posActor } from "../../../actor";
import { closeSchema, firstIssue } from "../../../schemas";

/** Cierra la caja con el efectivo contado (arqueo e informe Z). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = closeSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await closeSession(actor, (await params).id, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.sessions.close");
  }
}
