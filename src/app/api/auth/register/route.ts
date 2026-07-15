import * as argon2 from "argon2";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { account, session, user, verification } from "@/db/schema";
import { createAuthToken, getAuthCookieOptions, AUTH_TOKEN_COOKIE, hashAuthToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/http";
import { authSignUpSchema } from "@/server/schemas/forms";
import { escapeEmailHtml, isEmailDeliveryConfigured, sendEmail } from "@/server/email/send";

export async function POST(request: Request) {
  const parsed = authSignUpSchema.safeParse(await readJsonBody(request));

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de registro inválidos." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: "Ya existe una cuenta con ese email." }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  const now = new Date();
  const passwordHash = await argon2.hash(parsed.data.password);

  const requireVerification = process.env.NODE_ENV === "production" && process.env.REQUIRE_EMAIL_VERIFICATION !== "false";
  if (requireVerification && !isEmailDeliveryConfigured()) {
    return NextResponse.json({ error: "El registro está temporalmente deshabilitado porque el correo de verificación no está configurado." }, { status: 503 });
  }
  const verificationToken = requireVerification ? `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "") : null;

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
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      }
      return created;
    });

    if (verificationToken) {
      const baseUrl = (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
      const verifyUrl = `${baseUrl}/auth/verify-email?token=${encodeURIComponent(verificationToken)}`;
      await sendEmail({
        to: email,
        subject: "Verifica tu cuenta de ERP",
        html: `<p>Hola ${escapeEmailHtml(createdUser.name)},</p><p><a href="${escapeEmailHtml(verifyUrl)}">Verifica tu dirección de correo</a>. El enlace caduca en 24 horas.</p>`,
      });
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
