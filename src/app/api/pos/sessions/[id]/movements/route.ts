import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { addCashMovement } from "@/server/pos/service";

import { posActor } from "../../../actor";
import { firstIssue, movementSchema } from "../../../schemas";

/** Entrada o salida de efectivo del cajón (cambio, retirada…). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = movementSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await addCashMovement(actor, (await params).id, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.sessions.movement");
  }
}
