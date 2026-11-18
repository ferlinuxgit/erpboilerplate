import * as argon2 from "argon2";
import { and, eq, gt, isNull, like } from "drizzle-orm";
import { NextResponse } from "next/server";

import { user, verification } from "@/db/schema";
import { db } from "@/lib/db";
import { readJsonBody, httpErrorResponse } from "@/lib/http";
import { resolvePostAuthDestination, respondWithNewSession } from "@/server/auth/session";
import { getClientIp } from "@/lib/ip-policy";
import { getRateLimiter, RATE_LIMIT_RULES } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request) as { challengeId?: unknown; code?: unknown; next?: unknown; remember?: unknown } | null;
    const challengeId = typeof body?.challengeId === "string" ? body.challengeId : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!/^[0-9]{6}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(challengeId)) {
      return NextResponse.json({ error: "Código inválido." }, { status: 400 });
    }

    const prefix = `2fa:${challengeId}:`;
    // El reto se consume ANTES de comprobar el código (DELETE … RETURNING): un solo intento por
    // reto aunque lleguen varias peticiones a la vez.
    const [record] = await db.delete(verification).where(and(like(verification.identifier, `${prefix}%`), gt(verification.expiresAt, new Date()))).returning();
    if (!record?.identifier.startsWith(prefix)) {
      return NextResponse.json({ error: "Código incorrecto o caducado." }, { status: 401 });
    }
    const validCode = await argon2.verify(record.value, code).catch(() => false);
    if (!validCode) {
      return NextResponse.json({ error: "Código incorrecto o caducado. Solicita uno nuevo iniciando sesión de nuevo." }, { status: 401 });
    }
    const userId = record.identifier.slice(prefix.length);
    const [authUser] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(and(eq(user.id, userId), eq(user.emailVerified, true), isNull(user.disabledAt))).limit(1);
    if (!authUser) return NextResponse.json({ error: "Código incorrecto o caducado." }, { status: 401 });
    // Superado el segundo factor: se perdonan los intentos de este email desde esta IP.
    await getRateLimiter().reset(RATE_LIMIT_RULES.loginEmail, `${authUser.email}|${getClientIp(request.headers) ?? "unknown"}`);

    return respondWithNewSession(authUser, request, await resolvePostAuthDestination(authUser.id, body?.next), body?.remember === true);
  } catch (error) {
    return httpErrorResponse(error);
  }
}
