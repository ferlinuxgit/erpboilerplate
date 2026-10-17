import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { getSession } from "@/server/pos/service";

import { posActor } from "../../actor";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx } = await posActor("pos.read");
    const detail = await getSession(ctx.company.id, (await params).id);
    if (!detail) return jsonError(404, "Sesión de caja no encontrada.");
    return NextResponse.json(detail);
  } catch (error) {
    return handleRouteError(error, "pos.sessions.get");
  }
}
