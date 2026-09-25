import * as argon2 from "argon2";
import { and, eq, gt, like } from "drizzle-orm";
import { NextResponse } from "next/server";

import { user, verification } from "@/db/schema";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/http";
import { resolvePostAuthDestination, respondWithNewSession } from "@/server/auth/session";

export async function POST(request: Request) {
  const body = await readJsonBody(request) as { challengeId?: unknown; code?: unknown; next?: unknown } | null;
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

  return respondWithNewSession(authUser, request, await resolvePostAuthDestination(authUser.id, body?.next));
}
