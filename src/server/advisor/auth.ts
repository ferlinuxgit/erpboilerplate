import { createHash, randomBytes } from "node:crypto";

import * as argon2 from "argon2";
import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { advisorAccess, advisorSession, company } from "@/db/schema";
import { ADVISOR_LOGIN_PATH, normalizeAdvisorScopes, type AdvisorScope } from "@/lib/advisor-scopes";
import { db } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/http";
import { getClientIp } from "@/lib/ip-policy";
import { shouldUseSecureCookies } from "@/lib/secure-cookies";
import { ADVISOR_SESSION_MAX_AGE_SECONDS, advisorAccessStatus, isAccessUsableForSession, normalizeAdvisorEmail } from "@/server/advisor/access-model";
import { recordAudit } from "@/server/audit";

/**
 * Autenticación del portal del asesor. Es independiente de la del ERP: cookie propia
 * (`erp_advisor_token`), tabla de sesiones propia y sin usuario ni membership. Un asesor nunca
 * obtiene una sesión del ERP, y la sesión del portal solo abre las rutas `/asesor` y `/api/advisor`.
 */

export const ADVISOR_COOKIE = "erp_advisor_token";

export function advisorCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: shouldUseSecureCookies(), path: "/", maxAge: ADVISOR_SESSION_MAX_AGE_SECONDS };
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Hash con los mismos parámetros que los reales: si el email no existe verificamos contra él para
// que el tiempo de respuesta no permita saber qué emails tienen acceso.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash() {
  dummyHashPromise ??= argon2.hash(randomBytes(32).toString("hex")).catch((error: unknown) => {
    dummyHashPromise = null;
    throw error;
  });
  return dummyHashPromise;
}

export function hashAdvisorPassword(password: string) {
  return argon2.hash(password);
}

/**
 * Comprueba email y contraseña contra todos los accesos activos con ese email (una gestoría puede
 * llevar varias empresas) y abre una sesión con los que coinciden. Devuelve el token de la cookie o
 * `null` si no coincide ninguno.
 */
export async function signInAdvisor(input: { email: string; password: string; headers: Headers }) {
  const email = normalizeAdvisorEmail(input.email);
  const now = new Date();
  const candidates = (await db
    .select({ id: advisorAccess.id, tenantId: advisorAccess.tenantId, companyId: advisorAccess.companyId, passwordHash: advisorAccess.passwordHash, revokedAt: advisorAccess.revokedAt, expiresAt: advisorAccess.expiresAt, companyName: company.name })
    .from(advisorAccess)
    .innerJoin(company, eq(company.id, advisorAccess.companyId))
    .where(eq(advisorAccess.email, email))
    .orderBy(asc(company.name))).filter((candidate) => advisorAccessStatus(candidate, now) === "ACTIVE");

  if (candidates.length === 0) {
    await argon2.verify(await getDummyHash(), input.password).catch(() => false);
    return null;
  }
  const matched: typeof candidates = [];
  for (const candidate of candidates) {
    if (await argon2.verify(candidate.passwordHash, input.password).catch(() => false)) matched.push(candidate);
  }
  if (matched.length === 0) return null;

  const token = randomBytes(32).toString("base64url");
  const ipAddress = getClientIp(input.headers);
  // La sesión se crea un instante después del último cambio de credenciales (misma marca de tiempo inclusive).
  await db.insert(advisorSession).values({
    tokenHash: hashToken(token),
    email,
    accessIds: matched.map((access) => access.id),
    activeAccessId: matched[0].id,
    expiresAt: new Date(now.getTime() + ADVISOR_SESSION_MAX_AGE_SECONDS * 1000),
    ipAddress,
    userAgent: input.headers.get("user-agent")?.slice(0, 500) ?? null,
    createdAt: now,
  });
  await db.update(advisorAccess).set({ lastLoginAt: now, lastLoginIp: ipAddress }).where(inArray(advisorAccess.id, matched.map((access) => access.id)));
  for (const access of matched) {
    await recordAudit({ tenantId: access.tenantId, companyId: access.companyId, action: "advisor.login", entityName: "advisorAccess", entityId: access.id, payload: { email, ip: ipAddress } });
  }
  // Limpieza oportunista de sesiones caducadas.
  await db.delete(advisorSession).where(lt(advisorSession.expiresAt, now)).catch(() => undefined);
  return { token, companies: matched.map((access) => access.companyName) };
}

export type AdvisorContext = {
  sessionId: string;
  email: string;
  access: { id: string; name: string; firm: string | null; scopes: AdvisorScope[] };
  tenantId: string;
  company: {
    id: string;
    name: string;
    legalName: string | null;
    vatNumber: string | null;
    fiscalAddress: string | null;
    postalCode: string | null;
    city: string | null;
    province: string | null;
    countryCode: string;
    timezone: string;
    baseCurrencyCode: string;
  };
  /** Empresas a las que puede cambiar en esta sesión. */
  companies: Array<{ accessId: string; companyName: string }>;
};

/** Contexto del asesor de la petición (memoizado por render), o `null` sin sesión válida. */
export const getAdvisorContext = cache(async function getAdvisorContext(): Promise<AdvisorContext | null> {
  const token = (await cookies()).get(ADVISOR_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const now = new Date();
  const [session] = await db
    .select()
    .from(advisorSession)
    .where(and(eq(advisorSession.tokenHash, hashToken(token)), gt(advisorSession.expiresAt, now)))
    .limit(1);
  if (!session) return null;

  const accesses = (await db
    .select({
      id: advisorAccess.id,
      name: advisorAccess.name,
      firm: advisorAccess.firm,
      scopes: advisorAccess.scopes,
      tenantId: advisorAccess.tenantId,
      revokedAt: advisorAccess.revokedAt,
      expiresAt: advisorAccess.expiresAt,
      credentialsChangedAt: advisorAccess.credentialsChangedAt,
      company: {
        id: company.id,
        name: company.name,
        legalName: company.legalName,
        vatNumber: company.vatNumber,
        fiscalAddress: company.fiscalAddress,
        postalCode: company.postalCode,
        city: company.city,
        province: company.province,
        countryCode: company.countryCode,
        timezone: company.timezone,
        baseCurrencyCode: company.baseCurrencyCode,
      },
    })
    .from(advisorAccess)
    .innerJoin(company, eq(company.id, advisorAccess.companyId))
    .where(and(inArray(advisorAccess.id, session.accessIds), eq(advisorAccess.email, session.email)))
    .orderBy(asc(company.name))).filter((access) => isAccessUsableForSession(access, session.createdAt, now));

  const active = accesses.find((access) => access.id === session.activeAccessId) ?? accesses[0];
  if (!active) return null;
  return {
    sessionId: session.id,
    email: session.email,
    access: { id: active.id, name: active.name, firm: active.firm, scopes: normalizeAdvisorScopes(active.scopes) },
    tenantId: active.tenantId,
    company: active.company,
    companies: accesses.map((access) => ({ accessId: access.id, companyName: access.company.name })),
  };
});

/** Para páginas del portal: sin sesión lleva al acceso; sin la sección, al resumen. */
export async function requireAdvisorPage(scope?: AdvisorScope) {
  const context = await getAdvisorContext();
  if (!context) redirect(ADVISOR_LOGIN_PATH);
  if (scope && !context.access.scopes.includes(scope)) redirect("/asesor");
  return context;
}

/** Para rutas `/api/advisor/*`: lanza 401/403 (combínalo con `handleRouteError`). */
export async function requireAdvisorApi(scope?: AdvisorScope) {
  const context = await getAdvisorContext();
  if (!context) throw new UnauthorizedError("Tu sesión ha caducado. Vuelve a entrar en el portal del asesor.");
  if (scope && !context.access.scopes.includes(scope)) throw new ForbiddenError("Esta sección no está incluida en tu acceso.");
  return context;
}

/** Cambia la empresa activa entre las de la sesión. */
export async function switchAdvisorCompany(context: AdvisorContext, accessId: string) {
  if (!context.companies.some((entry) => entry.accessId === accessId)) throw new ForbiddenError("No tienes acceso a esa empresa.");
  await db.update(advisorSession).set({ activeAccessId: accessId }).where(eq(advisorSession.id, context.sessionId));
}

export async function signOutAdvisor(token: string | undefined) {
  if (!token) return;
  await db.delete(advisorSession).where(eq(advisorSession.tokenHash, hashToken(token)));
}

/** Registra en la auditoría de la empresa lo que descarga o consulta el asesor. */
export async function recordAdvisorAudit(context: AdvisorContext, action: string, payload?: Record<string, unknown>) {
  await recordAudit({
    tenantId: context.tenantId,
    companyId: context.company.id,
    action,
    entityName: "advisorAccess",
    entityId: context.access.id,
    payload: { advisor: context.access.name, email: context.email, ...payload },
  });
}
