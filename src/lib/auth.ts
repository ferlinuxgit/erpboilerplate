import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { shouldUseSecureCookies } from "@/lib/secure-cookies";

const encoder = new TextEncoder();

export const AUTH_TOKEN_COOKIE = "erp_auth_token";
export const AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 8;
/** Duración de la sesión con «Mantener la sesión iniciada». */
export const REMEMBERED_AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function authTokenMaxAgeSeconds(remember: boolean) {
  return remember ? REMEMBERED_AUTH_TOKEN_MAX_AGE_SECONDS : AUTH_TOKEN_MAX_AGE_SECONDS;
}
/** Cabecera interna (fijada por `src/proxy.ts`) con la ruta solicitada, para `?next=`. */
export const REQUEST_PATH_HEADER = "x-erp-request-path";
/** Método HTTP de la petición (lo fija el proxy; el del cliente se sobrescribe). */
export const REQUEST_METHOD_HEADER = "x-erp-request-method";

export type JwtUser = {
  id: string;
  name: string;
  email: string;
};

/**
 * Autorización delegada a una aplicación (conector OAuth de Claude / ChatGPT o token personal
 * MCP): la sesión actúa como el usuario, pero fijada a una empresa y con un nivel de acceso.
 */
export type AuthGrant = {
  /** Identificador de la autorización (todas sus sesiones lo comparten; se revoca entero). */
  id: string;
  tenantId: string;
  companyId: string;
  /** "read": solo consultas (GET); "write": cualquier acción que permita el rol del usuario. */
  scope: "read" | "write";
  /** Nombre de la aplicación conectada (se muestra en Ajustes). */
  clientName: string;
};

export type JwtSession = {
  user: JwtUser;
  expiresAt: Date;
  issuedAt: Date;
  grant?: AuthGrant;
};

type JwtPayload = {
  sub: string;
  name: string;
  email: string;
  iat: number;
  exp: number;
  /** Identificador aleatorio: dos sesiones del mismo usuario en el mismo segundo no comparten token. */
  jti?: string;
  /** Autorización delegada (ver `AuthGrant`). */
  grt?: { id: string; tid: string; cid: string; scp: "read" | "write"; cli: string };
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (secret && (process.env.NODE_ENV !== "production" || secret.length >= 32)) {
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

export function createAuthToken(user: JwtUser, maxAgeSeconds = AUTH_TOKEN_MAX_AGE_SECONDS, grant?: AuthGrant) {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: user.id,
    name: user.name,
    email: user.email,
    iat: now,
    exp: now + maxAgeSeconds,
    jti: randomBytes(12).toString("base64url"),
    ...(grant ? { grt: { id: grant.id, tid: grant.tenantId, cid: grant.companyId, scp: grant.scope, cli: grant.clientName } } : {}),
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
    const decodedHeader = JSON.parse(base64UrlDecode(header)) as { alg?: string; typ?: string };
    if (decodedHeader.alg !== "HS256" || decodedHeader.typ !== "JWT") return null;
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
      issuedAt: new Date((payload.iat ?? 0) * 1000),
      ...(payload.grt?.id && payload.grt.tid && payload.grt.cid
        ? { grant: { id: payload.grt.id, tenantId: payload.grt.tid, companyId: payload.grt.cid, scope: payload.grt.scp === "write" ? "write" as const : "read" as const, clientName: payload.grt.cli ?? "Aplicación" } }
        : {}),
    };
  } catch {
    return null;
  }
}

export function hashAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Sin «mantener sesión» la cookie es de sesión del navegador (se borra al cerrarlo;
 * el token caduca igualmente a las 8 h). Con ella persiste 30 días.
 */
export function getAuthCookieOptions(remember = false) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(),
    path: "/",
    ...(remember ? { maxAge: REMEMBERED_AUTH_TOKEN_MAX_AGE_SECONDS } : {}),
  };
}

/** Propósitos de los tokens de un solo uso enviados por email (la firma los separa entre sí). */
export type SignedActionPurpose = "password-reset";

type SignedActionPayload = { sub: string; exp: number; n: string };

/**
 * Token firmado (HMAC con `JWT_SECRET`) y con caducidad para enlaces de un solo uso.
 * La firma permite rechazar enlaces manipulados o caducados sin consultar la base de
 * datos; el uso único lo garantiza quien lo emite guardando solo su hash.
 */
export function createSignedActionToken(purpose: SignedActionPurpose, subject: string, maxAgeSeconds: number, now = Date.now()) {
  const payload: SignedActionPayload = { sub: subject, exp: Math.floor(now / 1000) + maxAgeSeconds, n: randomBytes(24).toString("base64url") };
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${signInput(`${purpose}:${body}`)}`;
}

export function verifySignedActionToken(purpose: SignedActionPurpose, token: string | null | undefined, now = Date.now()) {
  if (!token || token.length > 1024) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, signInput(`${purpose}:${body}`))) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(body)) as Partial<SignedActionPayload>;
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(now / 1000)) return null;
    return { subject: payload.sub, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null;
  }
}

/**
 * Datos firmados (HMAC con `JWT_SECRET`) y con caducidad opcional, para estado que no se guarda en
 * base de datos (OAuth: cliente registrado, código de autorización, token de refresco). `purpose`
 * separa los usos: un token de un propósito nunca vale para otro.
 */
export function createSignedPayload(purpose: string, payload: Record<string, unknown>, maxAgeSeconds?: number, now = Date.now()) {
  const body = base64UrlEncode(JSON.stringify({ ...payload, ...(maxAgeSeconds ? { exp: Math.floor(now / 1000) + maxAgeSeconds } : {}) }));
  return `${body}.${signInput(`${purpose}:${body}`)}`;
}

export function verifySignedPayload<T extends Record<string, unknown>>(purpose: string, token: string | null | undefined, now = Date.now()): T | null {
  if (!token || token.length > 8192) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, signInput(`${purpose}:${body}`))) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(body)) as T & { exp?: unknown };
    if (typeof payload.exp === "number" && payload.exp <= Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
