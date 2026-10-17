import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { ENTRY_KINDS } from "@/modules/timesheets/model";
import { clock } from "@/server/timesheets/service";

import { timesheetActor } from "../actor";

const schema = z.object({ kind: z.enum(ENTRY_KINDS) });

/** Fichar la propia jornada desde la app. */
export async function POST(request: Request) {
  try {
    const { actor } = await timesheetActor("timesheet.own");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Fichaje no válido.");
    return NextResponse.json(await clock(actor, actor.actorUserId, parsed.data.kind, "APP"));
  } catch (error) {
    return handleRouteError(error, "timesheets.clock");
  }
}
