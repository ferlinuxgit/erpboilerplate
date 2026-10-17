import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { setWaitlistStatus, WAITLIST_STATUSES } from "@/server/pos/waitlist";

import { posActor } from "../../../actor";

const schema = z.object({ status: z.enum(WAITLIST_STATUSES) });

/** Avisado, sentado/reservado, quitar o volver a esperar. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Estado no válido.");
    return NextResponse.json(await setWaitlistStatus(actor, (await params).id, parsed.data.status));
  } catch (error) {
    return handleRouteError(error, "pos.waitlist.status");
  }
}
