import * as argon2 from "argon2";
import { and, eq, gt, isNull, like } from "drizzle-orm";
import { NextResponse } from "next/server";

import { user, verification } from "@/db/schema";
import { db } from "@/lib/db";
import { readJsonBody, httpErrorResponse } from "@/lib/http";
import { resolvePostAuthDestination, respondWithNewSession } from "@/server/auth/session";
import { verifyUserSecondFactor } from "@/server/auth/two-factor-app";
import { getClientIp } from "@/lib/ip-policy";
import { getRateLimiter, RATE_LIMIT_RULES } from "@/lib/rate-limit";

/** Intentos por reto con la app (un despiste al teclear no obliga a empezar de nuevo). */
const TOTP_ATTEMPTS = 5;

function rejected(message = "Código incorrecto o caducado.") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request) as { challengeId?: unknown; code?: unknown; next?: unknown; remember?: unknown } | null;
    const challengeId = typeof body?.challengeId === "string" ? body.challengeId : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    // Seis dígitos (correo o app) o un código de recuperación (XXXXX-XXXXX).
    if (!/^([0-9]{6}|[A-Za-z2-7]{5}-?[A-Za-z2-7]{5})$/.test(code) || !/^[0-9a-f-]{36}$/i.test(challengeId)) {
      return NextResponse.json({ error: "Código inválido." }, { status: 400 });
    }

    // El reto se consume ANTES de comprobar el código (DELETE … RETURNING): peticiones simultáneas
    // no pueden probar a la vez más de un código por reto.
    const [record] = await db
      .delete(verification)
      .where(and(like(verification.identifier, `2fa%:${challengeId}:%`), gt(verification.expiresAt, new Date())))
      .returning();
    const emailPrefix = `2fa:${challengeId}:`;
    const totpPrefix = `2fa-totp:${challengeId}:`;
    let userId: string;
    if (record?.identifier.startsWith(totpPrefix)) {
      userId = record.identifier.slice(totpPrefix.length);
      if (!(await verifyUserSecondFactor(userId, code))) {
        const attempts = Number(record.value) + 1;
        if (attempts >= TOTP_ATTEMPTS) return rejected("Demasiados intentos. Inicia sesión de nuevo.");
        await db.insert(verification).values({ id: crypto.randomUUID(), identifier: record.identifier, value: String(attempts), expiresAt: record.expiresAt });
        return rejected("El código no es correcto. Prueba con el siguiente de la app o con un código de recuperación.");
      }
    } else if (record?.identifier.startsWith(emailPrefix)) {
      if (!(await argon2.verify(record.value, code).catch(() => false))) {
        return rejected("Código incorrecto o caducado. Solicita uno nuevo iniciando sesión de nuevo.");
      }
      userId = record.identifier.slice(emailPrefix.length);
    } else {
      return rejected();
    }

    const [authUser] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(and(eq(user.id, userId), eq(user.emailVerified, true), isNull(user.disabledAt))).limit(1);
    if (!authUser) return rejected();
    // Superado el segundo factor: se perdonan los intentos de este email desde esta IP.
    await getRateLimiter().reset(RATE_LIMIT_RULES.loginEmail, `${authUser.email}|${getClientIp(request.headers) ?? "unknown"}`);

    return respondWithNewSession(authUser, request, await resolvePostAuthDestination(authUser.id, body?.next), body?.remember === true);
  } catch (error) {
    return httpErrorResponse(error);
  }
}
