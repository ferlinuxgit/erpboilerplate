import { asc, eq } from "drizzle-orm";

import { company, fiscalYear, membership, tenant } from "@/db/schema";
import { db } from "@/lib/db";

type UserTenantContext = {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  company: {
    id: string;
    name: string;
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

export async function ensureUserTenant(user: { id: string; name: string }): Promise<UserTenantContext> {
  const existingMembership = await db
    .select({
      membershipId: membership.id,
      role: membership.role,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      companyId: company.id,
      companyName: company.name,
      companyBaseCurrencyCode: company.baseCurrencyCode,
      fiscalYearId: fiscalYear.id,
      fiscalYearCode: fiscalYear.code,
    })
    .from(membership)
    .innerJoin(tenant, eq(membership.tenantId, tenant.id))
    .innerJoin(company, eq(company.tenantId, tenant.id))
    .innerJoin(fiscalYear, eq(fiscalYear.companyId, company.id))
    .where(eq(membership.userId, user.id))
    .orderBy(asc(membership.createdAt))
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

  const uniqueSlug = await createUniqueSlug(`${user.name}-tenant`);

  const createdTenant = await db.transaction(async (tx) => {
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
