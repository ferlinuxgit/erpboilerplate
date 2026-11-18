import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody, UnauthorizedError } from "@/lib/http";
import { getRateLimiter, RATE_LIMIT_RULES } from "@/lib/rate-limit";
import { changePassword } from "@/server/auth/account-security";

const schema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });

/** Cambiar la contraseña con la sesión iniciada (cierra las demás sesiones). */
export async function POST(request: Request) {
  try {
    const current = await getUserSession();
    if (!current?.user) throw new UnauthorizedError();
    if (current.grant) return jsonError(403, "Esto solo se puede hacer desde la aplicación.");
    const limit = await getRateLimiter().limit(RATE_LIMIT_RULES.resetPassword, `change:${current.user.id}`);
    if (!limit.success) return jsonError(429, "Demasiados intentos: espera unos minutos.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Indica la contraseña actual y la nueva.");
    const revoked = await changePassword(current.user.id, parsed.data.currentPassword, parsed.data.newPassword);
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    return handleRouteError(error, "auth.change_password", "No se pudo cambiar la contraseña.");
  }
}
