import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { saveMenuItem } from "@/server/pos/menu";

import { posActor } from "../../../actor";
import { firstIssue, menuItemSchema } from "../../schemas";

/** Ficha de carta de un artículo (sección, textos, alérgenos, etiquetas). */
export async function PUT(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = menuItemSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await saveMenuItem(actor, (await params).itemId, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.menu.items.save");
  }
}
