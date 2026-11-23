import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody, UnauthorizedError } from "@/lib/http";
import { getRateLimiter, RATE_LIMIT_RULES } from "@/lib/rate-limit";
import { disableTotp, enableTotp, getTotpStatus, regenerateRecoveryCodes, startTotpSetup } from "@/server/auth/two-factor-app";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }),
  z.object({ action: z.enum(["enable", "disable", "regenerate"]), code: z.string().trim().min(6).max(20) }),
]);

async function requireBrowserUser() {
  const current = await getUserSession();
  if (!current?.user) throw new UnauthorizedError();
  if (current.grant) return null;
  return current.user;
}

/** Estado de la verificación en dos pasos con app del usuario. */
export async function GET() {
  try {
    const sessionUser = await requireBrowserUser();
    if (!sessionUser) return jsonError(403, "Esto solo se puede hacer desde la aplicación.");
    return NextResponse.json(await getTotpStatus(sessionUser.id));
  } catch (error) {
    return handleRouteError(error, "auth.totp.status", "No se pudo leer la verificación en dos pasos.");
  }
}

/** Configurar (setup → enable), desactivar o renovar los códigos de recuperación. */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireBrowserUser();
    if (!sessionUser) return jsonError(403, "Esto solo se puede hacer desde la aplicación.");
    const limit = await getRateLimiter().limit(RATE_LIMIT_RULES.resetPassword, `totp:${sessionUser.id}`);
    if (!limit.success) return jsonError(429, "Demasiados intentos: espera unos minutos.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Indica el código de la app.");
    switch (parsed.data.action) {
      case "setup":
        return NextResponse.json(await startTotpSetup(sessionUser.id));
      case "enable":
        return NextResponse.json(await enableTotp(sessionUser.id, parsed.data.code));
      case "disable":
        await disableTotp(sessionUser.id, parsed.data.code);
        return NextResponse.json({ ok: true });
      case "regenerate":
        return NextResponse.json(await regenerateRecoveryCodes(sessionUser.id, parsed.data.code));
    }
  } catch (error) {
    return handleRouteError(error, "auth.totp", "No se pudo cambiar la verificación en dos pasos.");
  }
}
