import * as argon2 from "argon2";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { account, membership, tenantSecurityPolicy, user, verification } from "@/db/schema";
import { EMAIL_NOT_VERIFIED_CODE } from "@/lib/auth-client";
import { db } from "@/lib/db";
import { readJsonBody, httpErrorResponse } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getRateLimiter, RATE_LIMIT_RULES, tooManyRequestsResponse } from "@/lib/rate-limit";
import { authSignInSchema } from "@/server/schemas/forms";
import { isEmailDeliveryConfigured, sendEmail } from "@/server/email/send";
import { resolvePostAuthDestination, respondWithNewSession } from "@/server/auth/session";
import { getClientIp } from "@/lib/ip-policy";

const INVALID_CREDENTIALS_MESSAGE = "Email o contraseña incorrectos.";

// Hash con los mismos parámetros que los reales: si el email no existe verificamos
// contra él para que el tiempo de respuesta no permita enumerar usuarios.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash() {
  dummyHashPromise ??= argon2.hash(randomBytes(32).toString("hex")).catch((error: unknown) => {
    dummyHashPromise = null;
    throw error;
  });
  return dummyHashPromise;
}

async function verifyPassword(hash: string | null | undefined, password: string) {
  if (!hash) {
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    return false;
  }
  return argon2.verify(hash, password).catch(() => false);
}

function invalidCredentials() {
  return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const parsed = authSignInSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Introduce un email y una contraseña válidos." }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();

    // 5 intentos / 15 min por email desde la misma IP y 30 desde cualquiera (el límite por IP solo
    // lo aplica el proxy). Así un atacante no deja sin acceso al titular desde otra conexión.
    const limiter = getRateLimiter();
    const emailIpKey = `${email}|${getClientIp(request.headers) ?? "unknown"}`;
    for (const [rule, key] of [[RATE_LIMIT_RULES.loginEmail, emailIpKey], [RATE_LIMIT_RULES.loginEmailAny, email]] as const) {
      const emailLimit = await limiter.limit(rule, key);
      if (!emailLimit.success) {
        logger.warn({ bucket: rule.id }, "auth.login_rate_limited");
        return tooManyRequestsResponse(emailLimit);
      }
    }

    const [row] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        disabledAt: user.disabledAt,
        password: account.password,
      })
      .from(user)
      .innerJoin(account, and(eq(account.userId, user.id), isNotNull(account.password)))
      .where(eq(user.email, email))
      .limit(1);

    const validPassword = await verifyPassword(row?.password, parsed.data.password);
    if (!row || !validPassword) {
      return invalidCredentials();
    }

    if (row.disabledAt) {
      return NextResponse.json({ error: "Esta cuenta está bloqueada. Escríbenos si crees que es un error." }, { status: 403 });
    }

    if (!row.emailVerified) {
      return NextResponse.json({
        error: "Tu correo aún no está verificado. Abre el enlace que te enviamos o pide uno nuevo.",
        code: EMAIL_NOT_VERIFIED_CODE,
      }, { status: 403 });
    }

    const [twoFactorPolicy] = await db
      .select({ id: tenantSecurityPolicy.id })
      .from(membership)
      .innerJoin(tenantSecurityPolicy, eq(tenantSecurityPolicy.tenantId, membership.tenantId))
      .where(and(eq(membership.userId, row.id), eq(tenantSecurityPolicy.requireTwoFactor, true)))
      .limit(1);
    if (twoFactorPolicy) {
      if (!isEmailDeliveryConfigured()) return NextResponse.json({ error: "El doble factor no está disponible porque el correo no está configurado." }, { status: 503 });
      const challengeId = crypto.randomUUID();
      const code = randomInt(100_000, 1_000_000).toString();
      await db.insert(verification).values({
        id: crypto.randomUUID(),
        identifier: `2fa:${challengeId}:${row.id}`,
        value: await argon2.hash(code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      await sendEmail({ to: row.email, subject: "Código de acceso a ERP", html: `<p>Tu código de verificación es <strong>${code}</strong>.</p><p>Caduca en 10 minutos.</p>` });
      // Los intentos no se perdonan hasta superar también el segundo factor.
      return NextResponse.json({ requiresTwoFactor: true, challengeId }, { status: 202 });
    }
    await limiter.reset(RATE_LIMIT_RULES.loginEmail, emailIpKey);

    const authUser = { id: row.id, name: row.name, email: row.email };
    const { next, remember } = (body ?? {}) as { next?: unknown; remember?: unknown };
    return respondWithNewSession(authUser, request, await resolvePostAuthDestination(authUser.id, next), remember === true);
  } catch (error) {
    return httpErrorResponse(error);
  }
}
