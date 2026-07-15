import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { session, user, verification } from "@/db/schema";
import { AUTH_TOKEN_COOKIE, createAuthToken, getAuthCookieOptions, hashAuthToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/http";

export async function POST(request: Request) {
  const body = await readJsonBody(request) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token.length < 32) return NextResponse.json({ error: "Enlace de verificación inválido." }, { status: 400 });

  const tokenHash = hashAuthToken(token);
  const verifiedUser = await db.transaction(async (tx) => {
    const [record] = await tx.select().from(verification).where(and(eq(verification.value, tokenHash), gt(verification.expiresAt, new Date()))).for("update").limit(1);
    if (!record?.identifier.startsWith("email:")) return null;
    const userId = record.identifier.slice("email:".length);
    const [updatedUser] = await tx.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, userId)).returning({ id: user.id, name: user.name, email: user.email });
    if (!updatedUser) return null;
    await tx.delete(verification).where(eq(verification.identifier, record.identifier));
    return updatedUser;
  });

  if (!verifiedUser) return NextResponse.json({ error: "El enlace no existe o ha caducado." }, { status: 400 });
  const authToken = createAuthToken(verifiedUser);
  await db.insert(session).values({
    id: crypto.randomUUID(), token: hashAuthToken(authToken), userId: verifiedUser.id,
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });
  const response = NextResponse.json({ user: verifiedUser });
  response.cookies.set(AUTH_TOKEN_COOKIE, authToken, getAuthCookieOptions());
  return response;
}
