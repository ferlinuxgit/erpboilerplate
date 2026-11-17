import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { setupHospitality } from "@/server/pos/hospitality-setup";

import { posActor } from "../actor";
import { firstIssue } from "../hospitality/schemas";

const setupSchema = z.object({
  registerId: z.string().trim().min(1).nullable().optional(),
  registerName: z.string().trim().max(60).nullable().optional(),
  areas: z.array(z.object({ name: z.string().trim().max(40), tables: z.number().int().min(0).max(100), seats: z.number().int().min(1).max(50) })).min(1).max(10),
});

/** Asistente de puesta en marcha: caja en modo Mesas, salas y mesas de una vez. */
export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = setupSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await setupHospitality(actor, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.hospitality.setup");
  }
}
