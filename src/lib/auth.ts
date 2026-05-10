import { createHmac, timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();

export const AUTH_TOKEN_COOKIE = "erp_auth_token";
export const AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 8;

export type JwtUser = {
  id: string;
  name: string;
  email: string;
};

export type JwtSession = {
  user: JwtUser;
  expiresAt: Date;
};

type JwtPayload = {
  sub: string;
  name: string;
  email: string;
  iat: number;
  exp: number;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET ?? process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET no está definida en variables de entorno.");
  }

  return "development-only-jwt-secret-change-me";
}

function base64UrlEncode(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signInput(input: string) {
  return createHmac("sha256", encoder.encode(getJwtSecret())).update(input).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export function createAuthToken(user: JwtUser, maxAgeSeconds = AUTH_TOKEN_MAX_AGE_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: user.id,
    name: user.name,
    email: user.email,
    iat: now,
    exp: now + maxAgeSeconds,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = signInput(`${header}.${body}`);

  return `${header}.${body}.${signature}`;
}

export function verifyAuthToken(token: string | undefined | null): JwtSession | null {
  if (!token) {
    return null;
  }

  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) {
    return null;
  }

  const expectedSignature = signInput(`${header}.${body}`);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as Partial<JwtPayload>;
    if (!payload.sub || !payload.email || !payload.name || !payload.exp) {
      return null;
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      user: {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
      },
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch {
    return null;
  }
}

export function getAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_TOKEN_MAX_AGE_SECONDS,
  };
}
