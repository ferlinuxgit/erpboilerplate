import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { renameTenant } from "@/server/team/service";

const payloadSchema = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(80, "El nombre no puede superar 80 caracteres."),
});

/** Renombra el espacio de trabajo activo (aparece en invitaciones y en el selector de espacios). */
export async function PATCH(request: Request) {
  try {
    const { ctx, user } = await requirePermission("settings.manage", "Solo propietarios y administradores pueden renombrar el espacio de trabajo.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Nombre inválido.");
    const updated = await renameTenant(ctx.tenant.id, user.id, parsed.data.name);
    return updated ? NextResponse.json(updated) : jsonError(404, "Espacio de trabajo no encontrado.");
  } catch (error) {
    return handleRouteError(error, "tenant.rename", "No se pudo renombrar el espacio de trabajo.");
  }
}
