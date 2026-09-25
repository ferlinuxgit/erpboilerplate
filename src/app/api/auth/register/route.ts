import * as argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { account, user, verification } from "@/db/schema";
import { hashAuthToken } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-client";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { decidePostAuthDestination } from "@/lib/post-auth";
import { authSignUpSchema } from "@/server/schemas/forms";
import { isEmailDeliveryConfigured } from "@/server/email/send";
import { createVerificationToken, deliverVerificationEmail, replaceVerificationToken, VERIFICATION_LIFETIME_MS } from "@/server/auth/email-verification";
import { respondWithNewSession } from "@/server/auth/session";

function emailDeliveryFailedResponse(error: unknown, userId: string) {
  const smtpError = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        ...("code" in error && typeof error.code === "string" ? { code: error.code } : {}),
        ...("command" in error && typeof error.command === "string" ? { command: error.command } : {}),
        ...("host" in error && typeof error.host === "string" ? { host: error.host } : {}),
        ...("reason" in error && typeof error.reason === "string" ? { reason: error.reason } : {}),
      }
    : { message: String(error) };
  logger.error({ smtpError, userId }, "auth.verification_email_delivery_failed");
  return NextResponse.json({
    error: "La cuenta existe, pero no se pudo enviar el correo de verificación. Revisa la configuración SMTP e inténtalo de nuevo.",
  }, { status: 502 });
}

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const parsed = authSignUpSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de registro inválidos." }, { status: 400 });
  }

  // Ruta de retorno (p. ej. `/invitations/…`): se conserva en el enlace de verificación y al entrar.
  const nextPath = safeNextPath((body as { next?: unknown } | null)?.next);
  const email = parsed.data.email.toLowerCase().trim();
  const requireVerification = process.env.NODE_ENV === "production" && process.env.REQUIRE_EMAIL_VERIFICATION !== "false";
  const [existing] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      password: account.password,
    })
    .from(user)
    .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
    .where(eq(user.email, email))
    .limit(1);

  if (existing) {
    if (!requireVerification || existing.emailVerified || !existing.password) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese email. Inicia sesión o recupera tu contraseña." }, { status: 409 });
    }
    const validPassword = await argon2.verify(existing.password, parsed.data.password).catch(() => false);
    if (!validPassword) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese email. Inicia sesión o recupera tu contraseña." }, { status: 409 });
    }
    if (!isEmailDeliveryConfigured()) {
      return NextResponse.json({ error: "El correo de verificación no está configurado." }, { status: 503 });
    }

    const verificationToken = createVerificationToken();
    await db.transaction((tx) => replaceVerificationToken(tx, existing.id, verificationToken));

    try {
      await deliverVerificationEmail({ email: existing.email, name: existing.name, token: verificationToken, request, next: nextPath });
    } catch (error) {
      return emailDeliveryFailedResponse(error, existing.id);
    }

    return NextResponse.json({
      user: { id: existing.id, name: existing.name, email: existing.email },
      requiresEmailVerification: true,
      verificationEmailResent: true,
    }, { status: 202 });
  }

  if (requireVerification && !isEmailDeliveryConfigured()) {
    return NextResponse.json({ error: "El registro está temporalmente deshabilitado porque el correo de verificación no está configurado." }, { status: 503 });
  }

  const userId = crypto.randomUUID();
  const now = new Date();
  const passwordHash = await argon2.hash(parsed.data.password);
  const verificationToken = requireVerification ? createVerificationToken() : null;

  try {
    const createdUser = await db.transaction(async (tx) => {
      const [created] = await tx.insert(user).values({
        id: userId,
        name: parsed.data.name.trim(),
        email,
        emailVerified: !requireVerification,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: user.id, name: user.name, email: user.email });
      await tx.insert(account).values({
        id: crypto.randomUUID(), accountId: email, providerId: "credential", userId: created.id,
        password: passwordHash, createdAt: now, updatedAt: now,
      });
      if (verificationToken) {
        await tx.insert(verification).values({
          id: crypto.randomUUID(),
          identifier: `email:${created.id}`,
          value: hashAuthToken(verificationToken),
          expiresAt: new Date(Date.now() + VERIFICATION_LIFETIME_MS),
        });
      }
      return created;
    });

    if (verificationToken) {
      try {
        await deliverVerificationEmail({ email, name: createdUser.name, token: verificationToken, request, next: nextPath });
      } catch (error) {
        return emailDeliveryFailedResponse(error, createdUser.id);
      }
      return NextResponse.json({ user: createdUser, requiresEmailVerification: true }, { status: 202 });
    }

    // Alta nueva sin espacio de trabajo todavía: directo a la puesta en marcha (o a la invitación).
    return respondWithNewSession(createdUser, request, decidePostAuthDestination({ nextPath, membership: null }));
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return NextResponse.json({ error: "Ya existe una cuenta con ese email. Inicia sesión o recupera tu contraseña." }, { status: 409 });
    throw error;
  }
}
