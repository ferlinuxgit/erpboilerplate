import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { voidEntry } from "@/server/timesheets/service";

import { timesheetActor } from "../../../actor";

const schema = z.object({ reason: z.string().trim().min(1, "Indica el motivo.").max(300) });

/** Anular una marca errónea (se conserva con el motivo). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await timesheetActor("timesheet.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    return NextResponse.json(await voidEntry(actor, (await params).id, parsed.data.reason));
  } catch (error) {
    return handleRouteError(error, "timesheets.void");
  }
}
