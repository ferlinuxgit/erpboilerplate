import * as argon2 from "argon2";
import { and, eq, gt, like } from "drizzle-orm";
import { NextResponse } from "next/server";

import { session, user, verification } from "@/db/schema";
import { AUTH_TOKEN_COOKIE, createAuthToken, getAuthCookieOptions, hashAuthToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/http";

export async function POST(request: Request) {
  const body = await readJsonBody(request) as { challengeId?: unknown; code?: unknown } | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^[0-9]{6}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(challengeId)) {
    return NextResponse.json({ error: "Código inválido." }, { status: 400 });
  }

  const prefix = `2fa:${challengeId}:`;
  const [record] = await db.select().from(verification).where(and(like(verification.identifier, `${prefix}%`), gt(verification.expiresAt, new Date()))).limit(1);
  if (!record?.identifier.startsWith(prefix)) {
    return NextResponse.json({ error: "Código incorrecto o caducado." }, { status: 401 });
  }
  const validCode = await argon2.verify(record.value, code).catch(() => false);
  if (!validCode) {
    await db.delete(verification).where(eq(verification.id, record.id));
    return NextResponse.json({ error: "Código incorrecto o caducado. Solicita uno nuevo iniciando sesión de nuevo." }, { status: 401 });
  }
  const userId = record.identifier.slice(prefix.length);
  const [authUser] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(and(eq(user.id, userId), eq(user.emailVerified, true))).limit(1);
  if (!authUser) return NextResponse.json({ error: "Código incorrecto o caducado." }, { status: 401 });
  const [consumed] = await db.delete(verification).where(eq(verification.id, record.id)).returning({ id: verification.id });
  if (!consumed) return NextResponse.json({ error: "El código ya fue utilizado." }, { status: 401 });

  const token = createAuthToken(authUser);
  await db.insert(session).values({
    id: crypto.randomUUID(), token: hashAuthToken(token), userId: authUser.id,
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });
  const response = NextResponse.json({ user: authUser });
  response.cookies.set(AUTH_TOKEN_COOKIE, token, getAuthCookieOptions());
  return response;
}
