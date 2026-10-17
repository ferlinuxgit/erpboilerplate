import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { createSection } from "@/server/pos/menu";

import { posActor } from "../../actor";
import { firstIssue, sectionSchema } from "../schemas";

export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = sectionSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await createSection(actor, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.menu.sections.create");
  }
}
