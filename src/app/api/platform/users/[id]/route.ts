import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { applyPlatformUserAction, requirePlatformAdmin } from "@/server/platform/service";

const actionSchema = z.object({ action: z.enum(["disable", "enable", "revokeSessions"]) });

/** Bloquear, desbloquear o cerrar todas las sesiones de un usuario. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await params;
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Acción no válida.");
    await applyPlatformUserAction(admin.id, id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "platform.user.patch");
  }
}
