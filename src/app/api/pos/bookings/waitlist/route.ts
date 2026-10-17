import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { addWalkIn } from "@/server/pos/waitlist";

import { posActor } from "../../actor";

const schema = z.object({
  name: z.string().trim().min(1, "Pon un nombre.").max(80),
  partySize: z.number().int().min(1).max(500),
  phone: z.string().trim().max(30).nullable().optional().transform((value) => value || null),
  notes: z.string().trim().max(300).nullable().optional().transform((value) => value || null),
});

/** Grupo esperando en la puerta. */
export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    return NextResponse.json(await addWalkIn(actor, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.waitlist.walk_in");
  }
}
