import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { ENTRY_KINDS } from "@/modules/timesheets/model";
import { addCorrection } from "@/server/timesheets/service";

import { timesheetActor } from "../actor";

const schema = z.object({
  userId: z.string().trim().min(1),
  kind: z.enum(ENTRY_KINDS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida."),
  note: z.string().trim().min(1, "Indica el motivo de la corrección.").max(300),
});

/** Corrección de un responsable (olvido de fichar, error de hora). */
export async function POST(request: Request) {
  try {
    const { actor } = await timesheetActor("timesheet.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    return NextResponse.json(await addCorrection(actor, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "timesheets.correction");
  }
}
