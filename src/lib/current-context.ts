import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";

import { company, fiscalYear, membership, tenant } from "@/db/schema";
import { getActiveContextCookies } from "@/lib/active-context";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/http";
import { can, type PermissionKey } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

type AuthenticatedContext = Omit<Awaited<ReturnType<typeof ensureUserTenant>>, "company"> & {
  company: {
    id: string;
    name: string;
    countryCode: string;
    baseCurrencyCode: string;
    timezone: string;
  };
  availableCompanies: Array<{ id: string; name: string; countryCode: string; baseCurrencyCode: string; timezone: string }>;
  availableFiscalYears: Array<{ id: string; code: string }>;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

/**
 * Contexto completo (tenant activo, empresa, ejercicio y opciones disponibles).
 * Lanza `UnauthorizedError` (401) o `ForbiddenError` (403); en route handlers
 * captúralos con `handleRouteError` de `@/lib/http`.
 */
export async function requireContext(permission?: PermissionKey): Promise<AuthenticatedContext> {
  const context = await resolveRequestContext();
  if (permission && !can(context.membership.role, permission)) {
    throw new ForbiddenError();
  }
  return context;
}

/**
 * Resolución del contexto memoizada por petición con React `cache()`: layout, page y
 * componentes que llaman a `requireContext` comparten las mismas consultas (sesión,
 * tenant, empresas y ejercicios). El permiso se comprueba fuera, en cada llamada.
 */
const resolveRequestContext = cache(async function resolveRequestContext(): Promise<AuthenticatedContext> {
  const session = await getUserSession();
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  const fallbackContext = await ensureUserTenant({
    id: session.user.id,
    name: session.user.name,
  });
  const activeCookies = await getActiveContextCookies();

  const availableCompanies = await db
    .select({
      id: company.id,
      name: company.name,
      countryCode: company.countryCode,
      baseCurrencyCode: company.baseCurrencyCode,
      timezone: company.timezone,
    })
    .from(company)
    .innerJoin(tenant, eq(tenant.id, company.tenantId))
    .innerJoin(membership, and(eq(membership.tenantId, tenant.id), eq(membership.userId, session.user.id)))
    .where(eq(tenant.id, fallbackContext.tenant.id))
    .orderBy(asc(company.name));

  const activeCompany =
    availableCompanies.find((entry) => entry.id === activeCookies.companyId) ??
    availableCompanies.find((entry) => entry.id === fallbackContext.company.id);

  const availableFiscalYears = await db
    .select({
      id: fiscalYear.id,
      code: fiscalYear.code,
    })
    .from(fiscalYear)
    .where(eq(fiscalYear.companyId, activeCompany?.id ?? fallbackContext.company.id))
    .orderBy(asc(fiscalYear.startsAt));

  const activeFiscalYear =
    availableFiscalYears.find((entry) => entry.id === activeCookies.fiscalYearId) ??
    availableFiscalYears.find((entry) => entry.id === fallbackContext.fiscalYear.id);

  const tenantContext = {
    ...fallbackContext,
    company: {
      id: activeCompany?.id ?? fallbackContext.company.id,
      name: activeCompany?.name ?? fallbackContext.company.name,
      countryCode: activeCompany?.countryCode ?? fallbackContext.company.countryCode,
      baseCurrencyCode: activeCompany?.baseCurrencyCode ?? fallbackContext.company.baseCurrencyCode,
      timezone: activeCompany?.timezone ?? "UTC",
    },
    fiscalYear: {
      id: activeFiscalYear?.id ?? fallbackContext.fiscalYear.id,
      code: activeFiscalYear?.code ?? fallbackContext.fiscalYear.code,
    },
  };

  return {
    ...tenantContext,
    availableCompanies,
    availableFiscalYears,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
  };
});
