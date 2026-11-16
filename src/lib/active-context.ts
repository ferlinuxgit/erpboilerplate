import { cookies } from "next/headers";
import { getRequestGrant } from "@/lib/request-grant";
import { shouldUseSecureCookies } from "@/lib/secure-cookies";

export const ACTIVE_TENANT_COOKIE = "active-tenant-id";
export const ACTIVE_COMPANY_COOKIE = "active-company-id";
export const ACTIVE_FISCAL_YEAR_COOKIE = "active-fiscal-year-id";

/**
 * Las cookies de contexto solo expresan una PREFERENCIA: el servidor siempre
 * las valida contra la membership del usuario antes de usarlas.
 */
export async function getActiveContextCookies() {
  const cookieStore = await cookies();
  // Conector de IA / token personal: la empresa es la que el usuario autorizó, no la de la cookie.
  const grant = await getRequestGrant();
  if (grant) {
    return { tenantId: grant.tenantId, companyId: grant.companyId, fiscalYearId: cookieStore.get(ACTIVE_FISCAL_YEAR_COOKIE)?.value ?? null };
  }
  return {
    tenantId: cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ?? null,
    companyId: cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value ?? null,
    fiscalYearId: cookieStore.get(ACTIVE_FISCAL_YEAR_COOKIE)?.value ?? null,
  };
}

/** Tenant preferido por el usuario (o `null` fuera de un request). */
export async function getActiveTenantCookie(): Promise<string | null> {
  const grant = await getRequestGrant();
  if (grant) return grant.tenantId;
  try {
    return (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

export function activeContextCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
}

type CookieWriter = {
  set(name: string, value: string, options: ReturnType<typeof activeContextCookieOptions>): unknown;
  delete(name: string): unknown;
};

/**
 * Cambia el tenant activo. Si no se indican empresa/ejercicio se borran para que
 * el servidor elija la empresa por defecto del nuevo tenant.
 */
export function writeActiveTenant(store: CookieWriter, tenantId: string, selection?: { companyId: string; fiscalYearId: string }) {
  const options = activeContextCookieOptions();
  store.set(ACTIVE_TENANT_COOKIE, tenantId, options);
  if (selection) {
    store.set(ACTIVE_COMPANY_COOKIE, selection.companyId, options);
    store.set(ACTIVE_FISCAL_YEAR_COOKIE, selection.fiscalYearId, options);
  } else {
    store.delete(ACTIVE_COMPANY_COOKIE);
    store.delete(ACTIVE_FISCAL_YEAR_COOKIE);
  }
}
