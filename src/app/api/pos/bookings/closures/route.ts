import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { addBookingClosure } from "@/server/pos/bookings";

import { posActor } from "../../actor";
import { closureSchema, firstIssue } from "../schemas";

export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = closureSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await addBookingClosure(actor, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.bookings.closures.create");
  }
}
