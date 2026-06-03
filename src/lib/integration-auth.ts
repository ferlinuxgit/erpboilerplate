import argon2 from "argon2";
import { asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiKey, company, fiscalYear, tenant } from "@/db/schema";
import { bearerToken } from "@/lib/api-auth-header";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import type { AppRole } from "@/lib/rbac";

type IntegrationContext = {
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
    role: AppRole;
  };
};

type AuthenticatedApiActor = {
  context: IntegrationContext;
  actorUserId: string;
  kind: "session" | "apiKey";
};

async function findApiKey(plainKey: string) {
  if (!plainKey.startsWith("ak_")) return null;

  const keys = await db.select().from(apiKey).where(isNull(apiKey.revokedAt));
  for (const key of keys) {
    if (await argon2.verify(key.keyHash, plainKey)) {
      return key;
    }
  }

  return null;
}

async function tenantContextFromApiKey(tenantId: string): Promise<IntegrationContext | null> {
  const [row] = await db
    .select({
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
    .from(tenant)
    .innerJoin(company, eq(company.tenantId, tenant.id))
    .innerJoin(fiscalYear, eq(fiscalYear.companyId, company.id))
    .where(eq(tenant.id, tenantId))
    .orderBy(asc(company.createdAt), asc(fiscalYear.startsAt))
    .limit(1);

  if (!row) return null;

  return {
    tenant: {
      id: row.tenantId,
      name: row.tenantName,
      slug: row.tenantSlug,
    },
    company: {
      id: row.companyId,
      name: row.companyName,
      countryCode: row.companyCountryCode,
      baseCurrencyCode: row.companyBaseCurrencyCode,
    },
    fiscalYear: {
      id: row.fiscalYearId,
      code: row.fiscalYearCode,
    },
    membership: {
      id: `api-key:${tenantId}`,
      role: "OWNER",
    },
  };
}

export async function authenticateApiActor(request: Request): Promise<AuthenticatedApiActor | NextResponse> {
  const token = bearerToken(request.headers.get("authorization"));

  if (token?.startsWith("ak_")) {
    const verifiedKey = await findApiKey(token);
    if (!verifiedKey) {
      return NextResponse.json({ message: "API key inválida." }, { status: 401 });
    }

    const context = await tenantContextFromApiKey(verifiedKey.tenantId);
    if (!context) {
      return NextResponse.json({ message: "La API key no tiene una empresa activa asociada." }, { status: 403 });
    }

    return {
      context,
      actorUserId: `api-key:${verifiedKey.id}`,
      kind: "apiKey",
    };
  }

  const session = await getUserSession();
  if (!session?.user) {
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  }

  return {
    context: await ensureUserTenant({ id: session.user.id, name: session.user.name }),
    actorUserId: session.user.id,
    kind: "session",
  };
}

export function isAuthError(value: AuthenticatedApiActor | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
