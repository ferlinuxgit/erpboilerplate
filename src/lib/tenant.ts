import { asc, eq } from "drizzle-orm";

import { company, fiscalYear, membership, tenant } from "@/db/schema";
import { db } from "@/lib/db";
import { getCompanyTemplate } from "@/lib/company-templates";
import { applyCompanyTemplate } from "@/server/seeds/apply";

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

const tenantProvisioningByUserId = new Map<string, Promise<UserTenantContext>>();

export async function ensureUserTenant(user: { id: string; name: string }): Promise<UserTenantContext> {
  const pendingProvisioning = tenantProvisioningByUserId.get(user.id);

  if (pendingProvisioning) {
    return pendingProvisioning;
  }

  const provisioning = ensureUserTenantInternal(user);
  tenantProvisioningByUserId.set(user.id, provisioning);

  try {
    return await provisioning;
  } finally {
    tenantProvisioningByUserId.delete(user.id);
  }
}

async function ensureUserTenantInternal(user: { id: string; name: string }): Promise<UserTenantContext> {
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

    if (getCompanyTemplate(createdCompanies[0].countryCode)) {
      await applyCompanyTemplate({
        tenantId: createdTenantRow.id,
        companyId: createdCompanies[0].id,
        activeFiscalYearId: createdFiscalYears[0].id,
        countryCode: createdCompanies[0].countryCode,
        actorUserId: user.id,
        auditAction: "company.defaults.apply",
        client: tx,
      });
    }

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
