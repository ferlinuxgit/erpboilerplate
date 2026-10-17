import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { handleTableRequest } from "@/server/pos/table-requests";

import { posActor } from "../../../actor";

const schema = z.object({ action: z.enum(["ACCEPT", "REJECT", "DONE"]), registerId: z.string().trim().nullable().optional(), waiterUserId: z.string().trim().nullable().optional() });

/** Atender una petición de una mesa (pedido, llamada o cuenta). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Acción no válida.");
    return NextResponse.json(await handleTableRequest(actor, (await params).id, parsed.data.action, { registerId: parsed.data.registerId ?? null, waiterUserId: parsed.data.waiterUserId ?? null }));
  } catch (error) {
    return handleRouteError(error, "pos.table_request");
  }
}
