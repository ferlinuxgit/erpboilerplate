import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { AUTH_TOKEN_COOKIE, hashAuthToken, REQUEST_PATH_HEADER, verifyAuthToken } from "@/lib/auth";
import { loginPathWithNext, SESSION_EXPIRED_REASON } from "@/lib/auth-client";
import { and, eq, gt } from "drizzle-orm";
import { company, fiscalYear, membership, session, tenantSecurityPolicy } from "@/db/schema";
import { ACTIVE_TENANT_COOKIE } from "@/lib/active-context";
import { db } from "@/lib/db";
import { getClientIp, isIpAllowed } from "@/lib/ip-policy";
import { activeMembershipOrder } from "@/lib/tenant";

function bearerToken(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

/**
 * Sesión del usuario de la petición actual. Memoizada con React `cache()`: dentro de
 * un mismo render (layout + page + componentes) la verificación del token, la sesión
 * persistida y la política de seguridad se consultan una sola vez. La memoización es
 * por petición (no se comparte entre usuarios ni peticiones); fuera de un render de
 * React (p. ej. tests) se ejecuta en cada llamada.
 */
export const getUserSession = cache(async function getUserSession() {
  const requestHeaders = await headers();
  const requestCookies = await cookies();
  const token = bearerToken(requestHeaders.get("authorization")) ?? requestCookies.get(AUTH_TOKEN_COOKIE)?.value;

  const verified = verifyAuthToken(token);
  if (!verified || !token) return null;
  const [persisted] = await db.select({ id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt }).from(session).where(and(eq(session.token, hashAuthToken(token)), eq(session.userId, verified.user.id), gt(session.expiresAt, new Date()))).limit(1);
  if (!persisted) return null;
  // Misma resolución de tenant que `ensureUserTenant`: la política aplicada es la
  // del tenant ACTIVO, no la de la primera membership.
  const [policy] = await db
    .select({ timeout: tenantSecurityPolicy.sessionTimeoutMinutes, allowedIpRanges: tenantSecurityPolicy.allowedIpNotes })
    .from(membership)
    .innerJoin(company, eq(company.tenantId, membership.tenantId))
    .innerJoin(fiscalYear, eq(fiscalYear.companyId, company.id))
    .leftJoin(tenantSecurityPolicy, eq(tenantSecurityPolicy.tenantId, membership.tenantId))
    .where(eq(membership.userId, verified.user.id))
    .orderBy(...activeMembershipOrder(requestCookies.get(ACTIVE_TENANT_COOKIE)?.value))
    .limit(1);
  if (policy?.allowedIpRanges?.trim()) {
    const clientIp = getClientIp(requestHeaders);
    // IP desconocida con allowlist activa → denegamos (fail closed).
    if (!clientIp || !isIpAllowed(clientIp, policy.allowedIpRanges)) return null;
  }
  const timeoutMinutes = policy?.timeout ?? null;
  if (timeoutMinutes && persisted.createdAt.getTime() + timeoutMinutes * 60_000 <= Date.now()) {
    await db.delete(session).where(eq(session.id, persisted.id));
    return null;
  }
  return verified;
});

/**
 * Para pages: si no hay sesión redirige a `/auth/login?next=<ruta actual>`.
 * Si había cookie de sesión (caducada/revocada) añade `reason=session-expired`
 * para que el login muestre un aviso amable.
 */
export async function requireUserSession() {
  const session = await getUserSession();

  if (!session?.user) {
    const requestHeaders = await headers();
    const hadSessionCookie = Boolean((await cookies()).get(AUTH_TOKEN_COOKIE)?.value);
    redirect(loginPathWithNext(requestHeaders.get(REQUEST_PATH_HEADER), hadSessionCookie ? SESSION_EXPIRED_REASON : undefined));
  }

  return session;
}
