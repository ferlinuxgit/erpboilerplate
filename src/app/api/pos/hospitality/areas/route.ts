import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import * as hospitality from "@/server/pos/hospitality";

import { posActor } from "../../actor";
import { firstIssue, areaSchema } from "../schemas";

export async function GET() {
  try {
    const { ctx } = await posActor("pos.read");
    return NextResponse.json(await hospitality.listAreasWithTables(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "pos.areas.list");
  }
}

export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = areaSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await hospitality.createArea(actor, parsed.data.name), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.areas.create");
  }
}
