import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { setSoldOut } from "@/server/pos/menu";

import { posActor } from "../../../../actor";
import { firstIssue, soldOutSchema } from "../../../schemas";

/** Agotado hoy: cualquier camarero puede marcarlo desde la sala. */
export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = soldOutSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await setSoldOut(actor, (await params).itemId, parsed.data.soldOut));
  } catch (error) {
    return handleRouteError(error, "pos.menu.items.sold_out");
  }
}
