import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { saveBookingSettings } from "@/server/pos/bookings";

import { posActor } from "../../actor";
import { firstIssue, settingsSchema } from "../schemas";

export async function PUT(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = settingsSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveBookingSettings(actor, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.bookings.settings");
  }
}
