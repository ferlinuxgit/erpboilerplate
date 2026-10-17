import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { refundTicket } from "@/server/pos/service";

import { posActor } from "../../../actor";
import { firstIssue, refundSchema } from "../../../schemas";

/** Devolución (completa o de algunas líneas) de un ticket: rectificativa, devolución del cobro y entrada de stock. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = refundSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await refundTicket(actor, { ...parsed.data, ticketId: (await params).id }), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.tickets.refund");
  }
}
