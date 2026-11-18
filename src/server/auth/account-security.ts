import * as argon2 from "argon2";
import { and, desc, eq, gt, isNull, ne, notLike, or } from "drizzle-orm";
import { cookies } from "next/headers";

import { account, session } from "@/db/schema";
import { AUTH_TOKEN_COOKIE, hashAuthToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

/** Sesiones de navegador (las de conectores de IA llevan «oauth:…» en userAgent; NULL también cuenta). */
const browserSession = or(isNull(session.userAgent), notLike(session.userAgent, "oauth:%"));

/** Sesión del navegador actual (para no cerrarla al cerrar las demás). */
async function currentSessionToken() {
  const token = (await cookies()).get(AUTH_TOKEN_COOKIE)?.value;
  return token ? hashAuthToken(token) : null;
}

/** Sesiones abiertas del usuario en navegadores (las de conectores de IA se ven en «Conectar con IA»). */
export async function listUserSessions(userId: string) {
  const current = await currentSessionToken();
  const rows = await db
    .select({ id: session.id, token: session.token, createdAt: session.createdAt, expiresAt: session.expiresAt, ipAddress: session.ipAddress, userAgent: session.userAgent })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date()), browserSession))
    .orderBy(desc(session.createdAt));
  return rows.map(({ token, ...row }) => ({ ...row, current: token === current }));
}

/** Cierra todas las sesiones de navegador menos la actual. */
export async function revokeOtherSessions(userId: string) {
  const current = await currentSessionToken();
  const removed = await db
    .delete(session)
    .where(and(eq(session.userId, userId), browserSession, current ? ne(session.token, current) : undefined))
    .returning({ id: session.id });
  return removed.length;
}

/** Cambia la contraseña sabiendo la actual y cierra las demás sesiones. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  if (newPassword.length < 8 || newPassword.length > 256) throw new HttpError(400, "La contraseña nueva debe tener entre 8 y 256 caracteres.");
  if (newPassword === currentPassword) throw new HttpError(400, "La contraseña nueva debe ser distinta de la actual.");
  const [credential] = await db.select({ id: account.id, password: account.password }).from(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential"))).limit(1);
  if (!credential?.password || !(await argon2.verify(credential.password, currentPassword).catch(() => false))) {
    throw new HttpError(400, "La contraseña actual no es correcta.");
  }
  await db.update(account).set({ password: await argon2.hash(newPassword), updatedAt: new Date() }).where(eq(account.id, credential.id));
  return revokeOtherSessions(userId);
}
