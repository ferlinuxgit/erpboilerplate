import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { setMenuItemImage } from "@/server/pos/menu";

import { posActor } from "../../../../actor";
import { firstIssue, imageSchema } from "../../../schemas";

/** Foto del plato (ya comprimida en el navegador) o null para quitarla. */
export async function PUT(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = imageSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await setMenuItemImage(actor, (await params).itemId, parsed.data.image));
  } catch (error) {
    return handleRouteError(error, "pos.menu.items.image");
  }
}
