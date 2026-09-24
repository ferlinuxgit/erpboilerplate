import { and, asc, eq, exists, sql, type SQL } from "drizzle-orm";
import { cache } from "react";

import { company, fiscalYear, membership, tenant } from "@/db/schema";
import { db } from "@/lib/db";
import { getActiveContextCookies, getActiveTenantCookie } from "@/lib/active-context";

type UserTenantContext = {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  company: {
    id: string;
    name: string;
    countryCode: string;
    baseCurrencyCode: string;
  };
  fiscalYear: {
    id: string;
    code: string;
  };
  membership: {
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
  };
};

function slugifyTenantName(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "workspace";
}

async function createUniqueSlug(baseName: string): Promise<string> {
  const baseSlug = slugifyTenantName(baseName);
  let candidate = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await db
      .select({ id: tenant.id })
      .from(tenant)
      .where(eq(tenant.slug, candidate))
      .limit(1);

    if (existing.length === 0) {
      return candidate;
    }

    counter += 1;
    candidate = `${baseSlug}-${counter}`;
  }
}

/**
 * Orden canónico para elegir la membership activa: primero el tenant preferido
 * (cookie `active-tenant-id`, que aquí solo actúa como preferencia porque la
 * consulta siempre filtra por `membership.userId`), después la membership más
 * antigua. Lo comparten `ensureUserTenant` y la política de seguridad de
 * `getUserSession`, de modo que ambos resuelven SIEMPRE el mismo tenant.
 */
export function activeMembershipOrder(preferredTenantId: string | null | undefined): SQL[] {
  const order: SQL[] = [];
  if (preferredTenantId) order.push(sql`case when ${membership.tenantId} = ${preferredTenantId} then 0 else 1 end`);
  order.push(asc(membership.createdAt), asc(company.createdAt), asc(fiscalYear.startsAt));
  return order;
}

/** Tenants del usuario que tienen al menos una empresa (los únicos activables). */
export async function listUserTenants(userId: string) {
  return db
    .select({ id: tenant.id, name: tenant.name, role: membership.role })
    .from(membership)
    .innerJoin(tenant, eq(tenant.id, membership.tenantId))
    .where(and(eq(membership.userId, userId), exists(db.select({ id: company.id }).from(company).where(eq(company.tenantId, tenant.id)))))
    .orderBy(asc(tenant.name));
}

const tenantProvisioningByUserId = new Map<string, Promise<UserTenantContext>>();

/**
 * Tenant, empresa y ejercicio activos del usuario (provisiona un tenant si no tiene).
 * Memoizado por petición con React `cache()` (clave: id y nombre del usuario, que son
 * primitivos: `cache` compara argumentos por identidad, no por valor).
 */
export function ensureUserTenant(user: { id: string; name: string }): Promise<UserTenantContext> {
  return ensureUserTenantForRequest(user.id, user.name);
}

const ensureUserTenantForRequest = cache((userId: string, userName: string) => ensureUserTenantUncached({ id: userId, name: userName }));

async function ensureUserTenantUncached(user: { id: string; name: string }): Promise<UserTenantContext> {
  const preferredTenantId = await getActiveTenantCookie();
  const provisioningKey = `${user.id}:${preferredTenantId ?? ""}`;
  const pendingProvisioning = tenantProvisioningByUserId.get(provisioningKey);

  if (pendingProvisioning) {
    return resolveActiveContext(await pendingProvisioning);
  }

  const provisioning = ensureUserTenantInternal(user, preferredTenantId);
  tenantProvisioningByUserId.set(provisioningKey, provisioning);

  try {
    return resolveActiveContext(await provisioning);
  } finally {
    tenantProvisioningByUserId.delete(provisioningKey);
  }
}

async function resolveActiveContext(fallback: UserTenantContext): Promise<UserTenantContext> {
  let activeCookies: Awaited<ReturnType<typeof getActiveContextCookies>>;
  try {
    activeCookies = await getActiveContextCookies();
  } catch {
    return fallback;
  }
  if (!activeCookies.companyId) return fallback;

  const [active] = await db
    .select({
      companyId: company.id,
      companyName: company.name,
      countryCode: company.countryCode,
      baseCurrencyCode: company.baseCurrencyCode,
      fiscalYearId: fiscalYear.id,
      fiscalYearCode: fiscalYear.code,
    })
    .from(company)
    .innerJoin(fiscalYear, and(eq(fiscalYear.companyId, company.id), activeCookies.fiscalYearId ? eq(fiscalYear.id, activeCookies.fiscalYearId) : eq(fiscalYear.id, fallback.fiscalYear.id)))
    .where(and(eq(company.id, activeCookies.companyId), eq(company.tenantId, fallback.tenant.id)))
    .limit(1);
  if (!active) return fallback;

  return {
    ...fallback,
    company: { id: active.companyId, name: active.companyName, countryCode: active.countryCode, baseCurrencyCode: active.baseCurrencyCode },
    fiscalYear: { id: active.fiscalYearId, code: active.fiscalYearCode },
  };
}

async function ensureUserTenantInternal(user: { id: string; name: string }, preferredTenantId: string | null): Promise<UserTenantContext> {
  const existingMembership = await db
    .select({
      membershipId: membership.id,
      role: membership.role,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      companyId: company.id,
      companyName: company.name,
      companyCountryCode: company.countryCode,
      companyBaseCurrencyCode: company.baseCurrencyCode,
      fiscalYearId: fiscalYear.id,
      fiscalYearCode: fiscalYear.code,
    })
    .from(membership)
    .innerJoin(tenant, eq(membership.tenantId, tenant.id))
    .innerJoin(company, eq(company.tenantId, tenant.id))
    .innerJoin(fiscalYear, eq(fiscalYear.companyId, company.id))
    .where(eq(membership.userId, user.id))
    .orderBy(...activeMembershipOrder(preferredTenantId))
    .limit(1);

  if (existingMembership.length > 0) {
    const current = existingMembership[0];
    return {
      tenant: {
        id: current.tenantId,
        name: current.tenantName,
        slug: current.tenantSlug,
      },
      company: {
        id: current.companyId,
        name: current.companyName,
        countryCode: current.companyCountryCode,
        baseCurrencyCode: current.companyBaseCurrencyCode,
      },
      fiscalYear: {
        id: current.fiscalYearId,
        code: current.fiscalYearCode,
      },
      membership: {
        id: current.membershipId,
        role: current.role,
      },
    };
  }

  const uniqueSlug = await createUniqueSlug(`${user.name}-${user.id.slice(0, 8)}-tenant`);

  const createdTenant = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tenant-provision:${user.id}`}))`);
    const [concurrentlyCreated] = await tx
      .select({
        membershipId: membership.id,
        role: membership.role,
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        companyId: company.id,
        companyName: company.name,
        companyCountryCode: company.countryCode,
        companyBaseCurrencyCode: company.baseCurrencyCode,
        fiscalYearId: fiscalYear.id,
        fiscalYearCode: fiscalYear.code,
      })
      .from(membership)
      .innerJoin(tenant, eq(membership.tenantId, tenant.id))
      .innerJoin(company, eq(company.tenantId, tenant.id))
      .innerJoin(fiscalYear, eq(fiscalYear.companyId, company.id))
      .where(eq(membership.userId, user.id))
      .orderBy(...activeMembershipOrder(preferredTenantId))
      .limit(1);
    if (concurrentlyCreated) {
      return {
        tenant: { id: concurrentlyCreated.tenantId, name: concurrentlyCreated.tenantName, slug: concurrentlyCreated.tenantSlug },
        company: { id: concurrentlyCreated.companyId, name: concurrentlyCreated.companyName, countryCode: concurrentlyCreated.companyCountryCode, baseCurrencyCode: concurrentlyCreated.companyBaseCurrencyCode },
        fiscalYear: { id: concurrentlyCreated.fiscalYearId, code: concurrentlyCreated.fiscalYearCode },
        membership: { id: concurrentlyCreated.membershipId, role: concurrentlyCreated.role },
      };
    }
    const createdTenants = await tx
      .insert(tenant)
      .values({
        name: `${user.name} Tenant`,
        slug: uniqueSlug,
        ownerId: user.id,
      })
      .returning({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      });

    const createdTenantRow = createdTenants[0];

    const createdMemberships = await tx
      .insert(membership)
      .values({
        userId: user.id,
        tenantId: createdTenantRow.id,
        role: "OWNER",
      })
      .returning({
        id: membership.id,
        role: membership.role,
      });

    const createdCompanies = await tx
      .insert(company)
      .values({
        tenantId: createdTenantRow.id,
        name: `${user.name} Company`,
      })
      .returning({
        id: company.id,
        name: company.name,
        countryCode: company.countryCode,
        baseCurrencyCode: company.baseCurrencyCode,
      });

    const createdFiscalYears = await tx
      .insert(fiscalYear)
      .values({
        companyId: createdCompanies[0].id,
        code: `${new Date().getUTCFullYear()}`,
        startsAt: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
        endsAt: new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31)),
      })
      .returning({
        id: fiscalYear.id,
        code: fiscalYear.code,
      });

    return {
      tenant: createdTenantRow,
      company: createdCompanies[0],
      fiscalYear: createdFiscalYears[0],
      membership: createdMemberships[0],
    };
  });

  return {
    tenant: createdTenant.tenant,
    company: createdTenant.company,
    fiscalYear: createdTenant.fiscalYear,
    membership: {
      id: createdTenant.membership.id,
      role: createdTenant.membership.role,
    },
  };
}
