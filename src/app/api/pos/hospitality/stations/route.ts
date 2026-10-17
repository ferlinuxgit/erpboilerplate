import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { listCategoryStations, saveCategoryStations } from "@/server/pos/hospitality";

import { posActor } from "../../actor";
import { firstIssue, stationsSchema } from "../schemas";

export async function GET() {
  try {
    const { ctx } = await posActor("pos.read");
    return NextResponse.json(await listCategoryStations(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "pos.stations.list");
  }
}

/** A qué estación (cocina, barra o ninguna) va cada categoría de productos. */
export async function PUT(request: Request) {
  try {
    const { actor, ctx } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = stationsSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    await saveCategoryStations(actor, parsed.data.entries);
    return NextResponse.json(await listCategoryStations(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "pos.stations.save");
  }
}
