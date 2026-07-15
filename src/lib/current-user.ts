import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_TOKEN_COOKIE, hashAuthToken, verifyAuthToken } from "@/lib/auth";
import { and, eq, gt } from "drizzle-orm";
import { membership, session, tenantSecurityPolicy } from "@/db/schema";
import { db } from "@/lib/db";

function bearerToken(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

export async function getUserSession() {
  const requestHeaders = await headers();
  const requestCookies = await cookies();
  const token = bearerToken(requestHeaders.get("authorization")) ?? requestCookies.get(AUTH_TOKEN_COOKIE)?.value;

  const verified = verifyAuthToken(token);
  if (!verified || !token) return null;
  const [persisted] = await db.select({ id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt }).from(session).where(and(eq(session.token, hashAuthToken(token)), eq(session.userId, verified.user.id), gt(session.expiresAt, new Date()))).limit(1);
  if (!persisted) return null;
  const policies = await db.select({ timeout: tenantSecurityPolicy.sessionTimeoutMinutes }).from(membership).innerJoin(tenantSecurityPolicy, eq(tenantSecurityPolicy.tenantId, membership.tenantId)).where(eq(membership.userId, verified.user.id));
  const configuredTimeouts = policies.map((policy) => policy.timeout).filter((value): value is number => Boolean(value));
  const timeoutMinutes = configuredTimeouts.length > 0 ? Math.min(...configuredTimeouts) : null;
  if (timeoutMinutes && persisted.createdAt.getTime() + timeoutMinutes * 60_000 <= Date.now()) {
    await db.delete(session).where(eq(session.id, persisted.id));
    return null;
  }
  return verified;
}

export async function requireUserSession() {
  const session = await getUserSession();

  if (!session?.user) {
    redirect("/auth/login");
  }

  return session;
}
