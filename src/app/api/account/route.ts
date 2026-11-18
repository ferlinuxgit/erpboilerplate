import { NextResponse } from "next/server";
import { z } from "zod";

import { AUTH_TOKEN_COOKIE } from "@/lib/auth";
import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody, UnauthorizedError } from "@/lib/http";
import { shouldUseSecureCookies } from "@/lib/secure-cookies";
import { deleteUserAccount } from "@/server/tenant/lifecycle";

const confirmSchema = z.object({ confirm: z.literal("BORRAR") });

/** Borra la cuenta del propio usuario (escribiendo BORRAR para confirmar) y cierra su sesión. */
export async function DELETE(request: Request) {
  try {
    const session = await getUserSession();
    if (!session?.user) throw new UnauthorizedError();
    // Un conector de IA no puede borrar la cuenta de nadie.
    if (session.grant) return jsonError(403, "Esto solo se puede hacer desde la aplicación.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    if (!confirmSchema.safeParse(payload).success) return jsonError(400, "Escribe BORRAR para confirmar.");
    await deleteUserAccount(session.user.id);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_TOKEN_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: shouldUseSecureCookies(), path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return handleRouteError(error, "account.delete", "No se pudo borrar la cuenta.");
  }
}
