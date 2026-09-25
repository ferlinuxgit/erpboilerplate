import * as argon2 from "argon2";
import { and, eq, gt } from "drizzle-orm";

import { account, session, user, verification } from "@/db/schema";
import { createSignedActionToken, hashAuthToken, verifySignedActionToken } from "@/lib/auth";
import { db } from "@/lib/db";

/** Vida del enlace de recuperación. */
export const PASSWORD_RESET_TTL_MINUTES = 60;

export function passwordResetIdentifier(userId: string) {
  return `password-reset:${userId}`;
}

type ResetUser = { id: string; name: string; email: string };

/** Persistencia del ciclo de vida (inyectable en tests). */
export type PasswordResetStore = {
  findUserByEmail(email: string): Promise<ResetUser | null>;
  /** Guarda el hash del token y anula cualquier enlace anterior del usuario. */
  replaceToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /**
   * Consume el token (lo borra si existe y no ha caducado) y, en la misma transacción,
   * cambia la contraseña y cierra todas las sesiones. Devuelve `false` si el token ya no vale.
   */
  consumeTokenAndSetPassword(userId: string, tokenHash: string, passwordHash: string, now: Date): Promise<boolean>;
};

export const drizzlePasswordResetStore: PasswordResetStore = {
  async findUserByEmail(email) {
    const [row] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
      .where(eq(user.email, email))
      .limit(1);
    return row ?? null;
  },
  async replaceToken(userId, tokenHash, expiresAt) {
    await db.transaction(async (tx) => {
      await tx.delete(verification).where(eq(verification.identifier, passwordResetIdentifier(userId)));
      await tx.insert(verification).values({ id: crypto.randomUUID(), identifier: passwordResetIdentifier(userId), value: tokenHash, expiresAt });
    });
  },
  async consumeTokenAndSetPassword(userId, tokenHash, passwordHash, now) {
    return db.transaction(async (tx) => {
      const consumed = await tx
        .delete(verification)
        .where(and(eq(verification.identifier, passwordResetIdentifier(userId)), eq(verification.value, tokenHash), gt(verification.expiresAt, now)))
        .returning({ id: verification.id });
      if (consumed.length === 0) return false;
      const updated = await tx
        .update(account)
        .set({ password: passwordHash, updatedAt: now })
        .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
        .returning({ id: account.id });
      if (updated.length === 0) return false;
      // Quien abre el enlace demuestra que controla el correo.
      await tx.update(user).set({ emailVerified: true, updatedAt: now }).where(eq(user.id, userId));
      await tx.delete(session).where(eq(session.userId, userId));
      return true;
    });
  },
};

/**
 * Crea un enlace de recuperación para `email`. Devuelve `null` si no hay cuenta con
 * contraseña (la ruta responde igual en ambos casos para no revelar qué emails existen).
 */
export async function requestPasswordReset(email: string, options: { store?: PasswordResetStore; now?: number } = {}) {
  const store = options.store ?? drizzlePasswordResetStore;
  const now = options.now ?? Date.now();
  const found = await store.findUserByEmail(email.trim().toLowerCase());
  if (!found) return null;
  const token = createSignedActionToken("password-reset", found.id, PASSWORD_RESET_TTL_MINUTES * 60, now);
  await store.replaceToken(found.id, hashAuthToken(token), new Date(now + PASSWORD_RESET_TTL_MINUTES * 60_000));
  return { user: found, token };
}

export type ResetPasswordResult = { status: "ok"; userId: string } | { status: "invalid" };

/** Valida firma, caducidad y uso único; si todo es correcto cambia la contraseña. */
export async function resetPassword(
  token: string,
  newPassword: string,
  options: { store?: PasswordResetStore; now?: number; hashPassword?: (password: string) => Promise<string> } = {},
): Promise<ResetPasswordResult> {
  const store = options.store ?? drizzlePasswordResetStore;
  const now = options.now ?? Date.now();
  const verified = verifySignedActionToken("password-reset", token, now);
  if (!verified) return { status: "invalid" };
  const passwordHash = await (options.hashPassword ?? ((password: string) => argon2.hash(password)))(newPassword);
  const consumed = await store.consumeTokenAndSetPassword(verified.subject, hashAuthToken(token), passwordHash, new Date(now));
  return consumed ? { status: "ok", userId: verified.subject } : { status: "invalid" };
}
