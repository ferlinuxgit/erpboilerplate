import { eq } from "drizzle-orm";

import { verification } from "@/db/schema";
import { hashAuthToken } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-client";
import type { DbClient } from "@/lib/db";
import { sendEmail } from "@/server/email/send";
import { appBaseUrl, verificationEmail } from "@/server/email/templates";

export const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function createVerificationToken() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

export function emailVerificationIdentifier(userId: string) {
  return `email:${userId}`;
}

/** Sustituye el token de verificación del usuario (solo vale el último enlace enviado). */
export async function replaceVerificationToken(client: DbClient, userId: string, token: string) {
  const identifier = emailVerificationIdentifier(userId);
  await client.delete(verification).where(eq(verification.identifier, identifier));
  await client.insert(verification).values({
    id: crypto.randomUUID(),
    identifier,
    value: hashAuthToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_LIFETIME_MS),
  });
}

/** Envía el enlace de verificación conservando la ruta de retorno (p. ej. una invitación). */
export async function deliverVerificationEmail(input: { email: string; name: string; token: string; request: Request; next?: unknown }) {
  const params = new URLSearchParams({ token: input.token });
  const next = safeNextPath(input.next);
  if (next) params.set("next", next);
  const message = verificationEmail({ name: input.name, url: `${appBaseUrl(input.request)}/auth/verify-email?${params.toString()}` });
  await sendEmail({ to: input.email, ...message });
}
