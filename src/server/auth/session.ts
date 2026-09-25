import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { company, companySettings, membership, session } from "@/db/schema";
import { AUTH_TOKEN_COOKIE, AUTH_TOKEN_MAX_AGE_SECONDS, createAuthToken, getAuthCookieOptions, hashAuthToken, type JwtUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-client";
import { companyInvoiceReadiness } from "@/lib/company-readiness";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/ip-policy";
import { logger } from "@/lib/logger";
import { decidePostAuthDestination, DEFAULT_AUTHENTICATED_PATH } from "@/lib/post-auth";

/** Crea la sesión persistida y responde con la cookie y el destino (`redirectTo`). */
export async function respondWithNewSession(authUser: JwtUser, request: Request, redirectTo: string) {
  const token = createAuthToken(authUser);
  await db.insert(session).values({
    id: crypto.randomUUID(),
    token: hashAuthToken(token),
    userId: authUser.id,
    expiresAt: new Date(Date.now() + AUTH_TOKEN_MAX_AGE_SECONDS * 1000),
    ipAddress: getClientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
  });
  const response = NextResponse.json({ user: authUser, redirectTo });
  response.cookies.set(AUTH_TOKEN_COOKIE, token, getAuthCookieOptions());
  return response;
}

/**
 * Destino tras autenticarse (ver `decidePostAuthDestination`). Usa la membership más
 * antigua, la misma que abrirá el panel por defecto. Nunca bloquea el acceso: ante un
 * error inesperado devuelve el panel.
 */
export async function resolvePostAuthDestination(userId: string, requestedNext: unknown): Promise<string> {
  const next = safeNextPath(requestedNext);
  if (next && next !== DEFAULT_AUTHENTICATED_PATH) return next;
  try {
    const [row] = await db
      .select({
        role: membership.role,
        completedAt: companySettings.onboardingCompletedAt,
        dismissedAt: companySettings.onboardingDismissedAt,
        legalName: company.legalName,
        vatNumber: company.vatNumber,
        fiscalAddress: company.fiscalAddress,
        postalCode: company.postalCode,
        city: company.city,
        province: company.province,
      })
      .from(membership)
      .innerJoin(company, eq(company.tenantId, membership.tenantId))
      .leftJoin(companySettings, eq(companySettings.companyId, company.id))
      .where(eq(membership.userId, userId))
      .orderBy(asc(membership.createdAt), asc(company.createdAt))
      .limit(1);
    return decidePostAuthDestination({
      membership: row
        ? { role: row.role, onboardingSettled: Boolean(row.completedAt || row.dismissedAt), companyReady: companyInvoiceReadiness(row).ready }
        : null,
    });
  } catch (error) {
    logger.error({ err: error, userId }, "auth.post_auth_destination_failed");
    return DEFAULT_AUTHENTICATED_PATH;
  }
}
