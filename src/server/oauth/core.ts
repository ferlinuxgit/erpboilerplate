/**
 * Servidor OAuth 2.1 para conectar el ERP con Claude, ChatGPT y cualquier cliente MCP en un clic.
 *
 * Sin tablas nuevas:
 * - Registro dinámico (RFC 7591): el `client_id` es un documento firmado con el nombre y las URLs
 *   de retorno del cliente; no hace falta guardarlo.
 * - Código de autorización: firmado, de un solo uso (registro en memoria) y válido 5 minutos,
 *   con PKCE S256 obligatorio.
 * - Token de acceso: una sesión real del usuario (tabla `session`) fijada a la empresa y al nivel
 *   de acceso que eligió (ver `AuthGrant`); toda la API funciona con él y con los permisos de su rol.
 * - Token de refresco: firmado; solo vale mientras la autorización siga viva (alguna sesión con su
 *   identificador). Cada refresco rota la sesión.
 * - Revocar una conexión (Ajustes › Conectar con IA o cambio de contraseña) borra sus sesiones.
 */
import { createHash, randomUUID } from "node:crypto";

import { and, eq, like } from "drizzle-orm";

import { company, membership, session, tenant, user } from "@/db/schema";
import { createAuthToken, createSignedPayload, hashAuthToken, verifySignedPayload, type AuthGrant, type JwtUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const OAUTH_SCOPES = ["erp:read", "erp:write"] as const;
/** Vida del token de acceso (la del refresco es mayor; los clientes refrescan solos). */
export const ACCESS_TOKEN_SECONDS = 60 * 60 * 24 * 7;
export const REFRESH_TOKEN_SECONDS = 60 * 60 * 24 * 180;
/** Tokens personales (clientes sin OAuth: Cursor, scripts…). */
export const PERSONAL_TOKEN_SECONDS = 60 * 60 * 24 * 90;
const CODE_SECONDS = 300;

/** Prefijo de `session.userAgent` que identifica las sesiones de una autorización. */
export const GRANT_SESSION_PREFIX = "oauth:";

export type OAuthClient = { name: string; redirectUris: string[] };

export class OAuthError extends Error {
  constructor(readonly error: string, message: string, readonly status = 400) {
    super(message);
  }
}

/** URL pública del ERP (APP_URL o, si falta, la de la petición tras el proxy). */
export function publicOrigin(request: Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** URL de retorno aceptable: https, o http solo en localhost (clientes de escritorio y CLI). */
export function isAllowedRedirectUri(value: string) {
  try {
    const url = new URL(value);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function registerClient(input: { client_name?: unknown; redirect_uris?: unknown }) {
  const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
  if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(isAllowedRedirectUri)) {
    throw new OAuthError("invalid_redirect_uri", "Indica entre 1 y 10 redirect_uris https (o http en localhost).");
  }
  const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim().slice(0, 80) : "Aplicación";
  const clientId = createSignedPayload("oauth-client", { n: name, r: redirectUris });
  return { clientId, client: { name, redirectUris } satisfies OAuthClient };
}

export function readClient(clientId: string | null | undefined): OAuthClient | null {
  const payload = verifySignedPayload<{ n?: unknown; r?: unknown }>("oauth-client", clientId);
  if (!payload || typeof payload.n !== "string" || !Array.isArray(payload.r)) return null;
  return { name: payload.n, redirectUris: payload.r.filter((uri): uri is string => typeof uri === "string") };
}

function clientFingerprint(clientId: string) {
  return createHash("sha256").update(clientId).digest("base64url").slice(0, 32);
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string | null;
  scope: "read" | "write";
};

/** Valida los parámetros de /oauth/authorize (antes de pedir el consentimiento). */
export function validateAuthorizationRequest(params: URLSearchParams): { request: AuthorizationRequest; client: OAuthClient } {
  const clientId = params.get("client_id") ?? "";
  const client = readClient(clientId);
  if (!client) throw new OAuthError("invalid_client", "La aplicación no está registrada. Vuelve a añadir el conector.");
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!client.redirectUris.includes(redirectUri)) throw new OAuthError("invalid_request", "La URL de retorno no coincide con la registrada por la aplicación.");
  if (params.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "Solo se admite response_type=code.");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    throw new OAuthError("invalid_request", "Falta PKCE (code_challenge con S256).");
  }
  const requested = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);
  return {
    client,
    request: { clientId, redirectUri, codeChallenge, state: params.get("state"), scope: requested.includes("erp:write") ? "write" : "read" },
  };
}

/** Empresas a las que el usuario puede dar acceso (todas las de sus espacios de trabajo). */
export async function listAuthorizableCompanies(userId: string) {
  return db
    .select({ tenantId: tenant.id, tenantName: tenant.name, companyId: company.id, companyName: company.name, role: membership.role })
    .from(membership)
    .innerJoin(tenant, eq(tenant.id, membership.tenantId))
    .innerJoin(company, eq(company.tenantId, tenant.id))
    .where(eq(membership.userId, userId))
    .orderBy(tenant.name, company.name);
}

async function assertMembership(userId: string, tenantId: string, companyId: string) {
  const [row] = await db
    .select({ id: membership.id })
    .from(membership)
    .innerJoin(company, and(eq(company.tenantId, membership.tenantId), eq(company.id, companyId)))
    .where(and(eq(membership.userId, userId), eq(membership.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new OAuthError("access_denied", "No tienes acceso a esa empresa.", 403);
}

/** Emite el código de autorización tras el consentimiento del usuario. */
export async function issueAuthorizationCode(input: AuthorizationRequest & { user: JwtUser; tenantId: string; companyId: string }) {
  await assertMembership(input.user.id, input.tenantId, input.companyId);
  return createSignedPayload("oauth-code", {
    j: randomUUID(),
    c: clientFingerprint(input.clientId),
    r: input.redirectUri,
    p: input.codeChallenge,
    s: input.scope,
    u: { id: input.user.id, name: input.user.name, email: input.user.email },
    t: input.tenantId,
    m: input.companyId,
  }, CODE_SECONDS);
}

/** Códigos ya canjeados (un solo uso). En memoria: caducan a los 5 minutos de todos modos. */
const usedCodes = new Map<string, number>();
function markCodeUsed(jti: string) {
  const now = Date.now();
  for (const [key, expires] of usedCodes) if (expires < now) usedCodes.delete(key);
  if (usedCodes.has(jti)) return false;
  usedCodes.set(jti, now + CODE_SECONDS * 1000);
  return true;
}

export type IssuedTokens = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token?: string; scope: string };

/** Crea la sesión de la autorización y su token de acceso. */
export async function createGrantSession(grant: AuthGrant, authUser: JwtUser, maxAgeSeconds: number) {
  const accessToken = createAuthToken(authUser, maxAgeSeconds, grant);
  await db.insert(session).values({
    id: randomUUID(),
    token: hashAuthToken(accessToken),
    userId: authUser.id,
    expiresAt: new Date(Date.now() + maxAgeSeconds * 1000),
    userAgent: `${GRANT_SESSION_PREFIX}${grant.id}:${grant.scope}:${grant.companyId}:${grant.clientName}`.slice(0, 500),
  });
  return accessToken;
}

function refreshTokenFor(grant: AuthGrant, authUser: JwtUser, clientId: string) {
  return createSignedPayload("oauth-refresh", {
    g: grant.id,
    c: clientFingerprint(clientId),
    s: grant.scope,
    t: grant.tenantId,
    m: grant.companyId,
    n: grant.clientName,
    u: { id: authUser.id, name: authUser.name, email: authUser.email },
  }, REFRESH_TOKEN_SECONDS);
}

function tokenResponse(accessToken: string, refreshToken: string, scope: "read" | "write"): IssuedTokens {
  return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refreshToken, scope: scope === "write" ? "erp:read erp:write" : "erp:read" };
}

type CodePayload = { j: string; c: string; r: string; p: string; s: "read" | "write"; u: JwtUser; t: string; m: string };

export async function exchangeAuthorizationCode(params: { code?: string | null; redirectUri?: string | null; clientId?: string | null; codeVerifier?: string | null }): Promise<IssuedTokens> {
  const code = verifySignedPayload<CodePayload>("oauth-code", params.code);
  if (!code) throw new OAuthError("invalid_grant", "Código de autorización inválido o caducado.");
  const client = readClient(params.clientId);
  if (!client || clientFingerprint(params.clientId ?? "") !== code.c) throw new OAuthError("invalid_client", "El código no pertenece a esta aplicación.");
  if (params.redirectUri !== code.r) throw new OAuthError("invalid_grant", "redirect_uri no coincide.");
  if (!params.codeVerifier || pkceChallenge(params.codeVerifier) !== code.p) throw new OAuthError("invalid_grant", "code_verifier (PKCE) incorrecto.");
  if (!markCodeUsed(code.j)) throw new OAuthError("invalid_grant", "El código ya se ha usado.");
  await assertMembership(code.u.id, code.t, code.m);
  const grant: AuthGrant = { id: randomUUID(), tenantId: code.t, companyId: code.m, scope: code.s, clientName: client.name };
  const accessToken = await createGrantSession(grant, code.u, ACCESS_TOKEN_SECONDS);
  return tokenResponse(accessToken, refreshTokenFor(grant, code.u, params.clientId ?? ""), grant.scope);
}

type RefreshPayload = { g: string; c: string; s: "read" | "write"; t: string; m: string; n: string; u: JwtUser };

/** Sesiones vivas (o caducadas pero no borradas) de una autorización: si no queda ninguna, está revocada. */
async function grantSessions(grantId: string) {
  return db.select({ id: session.id }).from(session).where(like(session.userAgent, `${GRANT_SESSION_PREFIX}${grantId}:%`));
}

export async function refreshAccessToken(params: { refreshToken?: string | null; clientId?: string | null }): Promise<IssuedTokens> {
  const payload = verifySignedPayload<RefreshPayload>("oauth-refresh", params.refreshToken);
  if (!payload) throw new OAuthError("invalid_grant", "Token de refresco inválido o caducado.");
  if (params.clientId && clientFingerprint(params.clientId) !== payload.c) throw new OAuthError("invalid_client", "El token de refresco no pertenece a esta aplicación.");
  const previous = await grantSessions(payload.g);
  if (previous.length === 0) throw new OAuthError("invalid_grant", "La conexión se ha revocado. Vuelve a conectar la aplicación.");
  const [account] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, payload.u.id)).limit(1);
  if (!account) throw new OAuthError("invalid_grant", "El usuario ya no existe.");
  await assertMembership(account.id, payload.t, payload.m);
  const grant: AuthGrant = { id: payload.g, tenantId: payload.t, companyId: payload.m, scope: payload.s, clientName: payload.n };
  const authUser = { id: account.id, name: account.name, email: account.email };
  // Rotación: la sesión anterior deja de valer.
  await db.delete(session).where(like(session.userAgent, `${GRANT_SESSION_PREFIX}${payload.g}:%`));
  const accessToken = await createGrantSession(grant, authUser, ACCESS_TOKEN_SECONDS);
  return tokenResponse(accessToken, createSignedPayload("oauth-refresh", { ...payload, u: authUser }, REFRESH_TOKEN_SECONDS), grant.scope);
}

/** Conexiones activas del usuario (una por autorización), para Ajustes. */
export async function listUserGrants(userId: string) {
  const rows = await db
    .select({ userAgent: session.userAgent, createdAt: session.createdAt, expiresAt: session.expiresAt })
    .from(session)
    .where(and(eq(session.userId, userId), like(session.userAgent, `${GRANT_SESSION_PREFIX}%`)));
  const grants = new Map<string, { id: string; scope: "read" | "write"; companyId: string; clientName: string; createdAt: Date; expiresAt: Date }>();
  for (const row of rows) {
    const [grantId, scope, companyId, ...name] = (row.userAgent ?? "").slice(GRANT_SESSION_PREFIX.length).split(":");
    if (!grantId) continue;
    const current = grants.get(grantId);
    if (!current || current.createdAt < row.createdAt) {
      grants.set(grantId, { id: grantId, scope: scope === "write" ? "write" : "read", companyId: companyId ?? "", clientName: name.join(":") || "Aplicación", createdAt: row.createdAt, expiresAt: row.expiresAt });
    }
  }
  return [...grants.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export async function revokeGrant(userId: string, grantId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(grantId)) return 0;
  const deleted = await db.delete(session).where(and(eq(session.userId, userId), like(session.userAgent, `${GRANT_SESSION_PREFIX}${grantId}:%`))).returning({ id: session.id });
  return deleted.length;
}

/** Token personal para clientes MCP sin OAuth: misma autorización, sin refresco (caduca a los 90 días). */
export async function issuePersonalToken(input: { user: JwtUser; tenantId: string; companyId: string; scope: "read" | "write"; name: string }) {
  await assertMembership(input.user.id, input.tenantId, input.companyId);
  const grant: AuthGrant = { id: randomUUID(), tenantId: input.tenantId, companyId: input.companyId, scope: input.scope, clientName: input.name.trim().slice(0, 60) || "Token personal" };
  return { token: await createGrantSession(grant, input.user, PERSONAL_TOKEN_SECONDS), grant };
}
