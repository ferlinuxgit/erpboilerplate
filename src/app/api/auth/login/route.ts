import * as argon2 from "argon2";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { account, membership, session, tenantSecurityPolicy, user, verification } from "@/db/schema";
import { AUTH_TOKEN_COOKIE, createAuthToken, getAuthCookieOptions, hashAuthToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/http";
import { getClientIp } from "@/lib/ip-policy";
import { logger } from "@/lib/logger";
import { getRateLimiter, RATE_LIMIT_RULES, tooManyRequestsResponse } from "@/lib/rate-limit";
import { authSignInSchema } from "@/server/schemas/forms";
import { isEmailDeliveryConfigured, sendEmail } from "@/server/email/send";

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
  const parsed = authSignInSchema.safeParse(await readJsonBody(request));

  if (!parsed.success) {
    return NextResponse.json({ error: "Introduce un email y una contraseña válidos." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  // 5 intentos fallidos / 15 min por email (el límite por IP lo aplica el proxy).
  const limiter = getRateLimiter();
  const emailLimit = await limiter.limit(RATE_LIMIT_RULES.loginEmail, email);
  if (!emailLimit.success) {
    logger.warn({ bucket: RATE_LIMIT_RULES.loginEmail.id }, "auth.login_rate_limited");
    return tooManyRequestsResponse(emailLimit);
  }

  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
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
  await limiter.reset(RATE_LIMIT_RULES.loginEmail, email);

  if (!row.emailVerified) {
    return NextResponse.json({ error: "Debes verificar tu dirección de correo antes de iniciar sesión." }, { status: 403 });
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
    return NextResponse.json({ requiresTwoFactor: true, challengeId }, { status: 202 });
  }

  const authUser = { id: row.id, name: row.name, email: row.email };
  const token = createAuthToken(authUser);
  await db.insert(session).values({ id: crypto.randomUUID(), token: hashAuthToken(token), userId: authUser.id, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), ipAddress: getClientIp(request.headers), userAgent: request.headers.get("user-agent") });
  const response = NextResponse.json({ user: authUser });
  response.cookies.set(AUTH_TOKEN_COOKIE, token, getAuthCookieOptions());

  return response;
}
