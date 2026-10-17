import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { ENTRY_KINDS } from "@/modules/timesheets/model";
import { kioskClock } from "@/server/timesheets/service";

import { timesheetActor } from "../actor";

const schema = z.object({ pin: z.string().trim().regex(/^\d{4,6}$/, "PIN incorrecto."), kind: z.enum(ENTRY_KINDS).nullable().optional() });

/** Tablet del local: identificarse con el PIN y fichar. */
export async function POST(request: Request) {
  try {
    const { actor } = await timesheetActor("timesheet.own");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    return NextResponse.json(await kioskClock(actor, parsed.data.pin, parsed.data.kind ?? null));
  } catch (error) {
    return handleRouteError(error, "timesheets.kiosk");
  }
}
