import { and, asc, eq } from "drizzle-orm";

import { company, fiscalYear, membership, tenant } from "@/db/schema";
import { getActiveContextCookies } from "@/lib/active-context";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { canFromDb, type PermissionKey } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

type AuthenticatedContext = Awaited<ReturnType<typeof ensureUserTenant>> & {
  availableCompanies: Array<{ id: string; name: string; baseCurrencyCode: string }>;
  availableFiscalYears: Array<{ id: string; code: string }>;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

export async function requireContext(permission?: PermissionKey): Promise<AuthenticatedContext> {
  const session = await getUserSession();
  if (!session?.user) {
    throw new Error("No autorizado.");
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
      baseCurrencyCode: company.baseCurrencyCode,
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
      baseCurrencyCode: activeCompany?.baseCurrencyCode ?? fallbackContext.company.baseCurrencyCode,
    },
    fiscalYear: {
      id: activeFiscalYear?.id ?? fallbackContext.fiscalYear.id,
      code: activeFiscalYear?.code ?? fallbackContext.fiscalYear.code,
    },
  };

  if (permission && !(await canFromDb(tenantContext.membership.role, permission))) {
    throw new Error("Sin permisos para ejecutar esta acción.");
  }

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
}
