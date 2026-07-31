import * as argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { account, session, user, verification } from "@/db/schema";
import { createAuthToken, getAuthCookieOptions, AUTH_TOKEN_COOKIE, hashAuthToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { authSignUpSchema } from "@/server/schemas/forms";
import { escapeEmailHtml, isEmailDeliveryConfigured, sendEmail } from "@/server/email/send";

const verificationLifetimeMs = 24 * 60 * 60 * 1000;

function createVerificationToken() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

async function deliverVerificationEmail(input: {
  email: string;
  name: string;
  token: string;
  request: Request;
}) {
  const baseUrl = (process.env.APP_URL ?? new URL(input.request.url).origin).replace(/\/$/, "");
  const verifyUrl = `${baseUrl}/auth/verify-email?token=${encodeURIComponent(input.token)}`;
  await sendEmail({
    to: input.email,
    subject: "Verifica tu cuenta de ERP",
    html: `<p>Hola ${escapeEmailHtml(input.name)},</p><p><a href="${escapeEmailHtml(verifyUrl)}">Verifica tu dirección de correo</a>. El enlace caduca en 24 horas.</p>`,
  });
}

function emailDeliveryFailedResponse(error: unknown, userId: string) {
  logger.error({ error, userId }, "auth.verification_email_delivery_failed");
  return NextResponse.json({
    error: "La cuenta existe, pero no se pudo enviar el correo de verificación. Revisa la configuración SMTP e inténtalo de nuevo.",
  }, { status: 502 });
}

export async function POST(request: Request) {
  const parsed = authSignUpSchema.safeParse(await readJsonBody(request));

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de registro inválidos." }, { status: 400 });
  }

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
      return NextResponse.json({ error: "Ya existe una cuenta con ese email." }, { status: 409 });
    }
    const validPassword = await argon2.verify(existing.password, parsed.data.password).catch(() => false);
    if (!validPassword) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese email." }, { status: 409 });
    }
    if (!isEmailDeliveryConfigured()) {
      return NextResponse.json({ error: "El correo de verificación no está configurado." }, { status: 503 });
    }

    const verificationToken = createVerificationToken();
    await db.transaction(async (tx) => {
      const identifier = `email:${existing.id}`;
      await tx.delete(verification).where(eq(verification.identifier, identifier));
      await tx.insert(verification).values({
        id: crypto.randomUUID(),
        identifier,
        value: hashAuthToken(verificationToken),
        expiresAt: new Date(Date.now() + verificationLifetimeMs),
      });
    });

    try {
      await deliverVerificationEmail({
        email: existing.email,
        name: existing.name,
        token: verificationToken,
        request,
      });
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
          expiresAt: new Date(Date.now() + verificationLifetimeMs),
        });
      }
      return created;
    });

    if (verificationToken) {
      try {
        await deliverVerificationEmail({
          email,
          name: createdUser.name,
          token: verificationToken,
          request,
        });
      } catch (error) {
        return emailDeliveryFailedResponse(error, createdUser.id);
      }
      return NextResponse.json({ user: createdUser, requiresEmailVerification: true }, { status: 202 });
    }

    const token = createAuthToken(createdUser);
    await db.insert(session).values({ id: crypto.randomUUID(), token: hashAuthToken(token), userId: createdUser.id, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: request.headers.get("user-agent") });
    const response = NextResponse.json({ user: createdUser });
    response.cookies.set(AUTH_TOKEN_COOKIE, token, getAuthCookieOptions());
    return response;
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return NextResponse.json({ error: "Ya existe una cuenta con ese email." }, { status: 409 });
    throw error;
  }
}
