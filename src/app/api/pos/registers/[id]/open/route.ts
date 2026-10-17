import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { openSession } from "@/server/pos/service";

import { posActor } from "../../../actor";
import { firstIssue, openSchema } from "../../../schemas";

/** Abre la caja con el fondo inicial de efectivo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = openSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await openSession(actor, (await params).id, parsed.data.openingCash), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.sessions.open");
  }
}
