import argon2 from "argon2";
import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiKey, company, fiscalYear, tenant, tenantSecurityPolicy } from "@/db/schema";
import { bearerToken } from "@/lib/api-auth-header";
import { parseStoredApiKeyScopes } from "@/lib/api-key-scopes";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import { can, type AppRole, type PermissionKey } from "@/lib/rbac";

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

export type AuthenticatedApiActor = {
  context: IntegrationContext;
  actorUserId: string;
  kind: "session" | "apiKey";
  scopes: PermissionKey[] | null;
};

const API_KEY_FORMAT = /^ak_[a-z0-9]{12}_[a-z0-9]{32}$/i;

/**
 * Busca la API key por su prefijo público (`ak_<12>`, índice único) y verifica
 * el hash con argon2 sobre UNA sola fila.
 *
 * Las claves heredadas sin `keyPrefix` ya no se aceptan: exigían argon2 contra
 * todas las filas en cada request (DoS/coste lineal). Deben regenerarse
 * ("Rotar" en Ajustes → API keys), lo que les asigna prefijo.
 */
async function findApiKey(plainKey: string) {
  if (!API_KEY_FORMAT.test(plainKey)) return null;

  const keyPrefix = plainKey.split("_").slice(0, 2).join("_");
  const [key] = await db.select().from(apiKey).where(and(isNull(apiKey.revokedAt), eq(apiKey.keyPrefix, keyPrefix))).limit(1);
  if (!key || !(await argon2.verify(key.keyHash, plainKey).catch(() => false))) return null;

  const [policy] = await db.select({ rotationDays: tenantSecurityPolicy.apiKeyRotationDays }).from(tenantSecurityPolicy).where(eq(tenantSecurityPolicy.tenantId, key.tenantId)).limit(1);
  if (policy?.rotationDays && key.createdAt.getTime() + policy.rotationDays * 86_400_000 <= Date.now()) return null;
  await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, key.id));
  return key;
}

async function tenantContextFromApiKey(tenantId: string, companyId?: string | null): Promise<IntegrationContext | null> {
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
    .where(companyId ? and(eq(tenant.id, tenantId), eq(company.id, companyId)) : eq(tenant.id, tenantId))
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
      role: "ADMIN",
    },
  };
}

export async function authenticateApiActor(request: Request): Promise<AuthenticatedApiActor | NextResponse> {
  const token = bearerToken(request.headers.get("authorization"));

  if (token?.startsWith("ak_")) {
    const verifiedKey = await findApiKey(token);
    if (!verifiedKey) {
      return NextResponse.json(
        { message: "API key inválida, caducada o revocada. Si es una clave antigua, regénerala en Ajustes → API keys." },
        { status: 401 },
      );
    }

    const context = await tenantContextFromApiKey(verifiedKey.tenantId, verifiedKey.companyId);
    if (!context) {
      return NextResponse.json({ message: "La API key no tiene una empresa activa asociada." }, { status: 403 });
    }

    return {
      context,
      actorUserId: `api-key:${verifiedKey.id}`,
      kind: "apiKey",
      scopes: parseStoredApiKeyScopes(verifiedKey.scopes),
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
    scopes: null,
  };
}

export function hasApiActorPermission(actor: AuthenticatedApiActor, permission: PermissionKey) {
  return actor.kind === "apiKey" ? Boolean(actor.scopes?.includes(permission)) : can(actor.context.membership.role, permission);
}

export function isAuthError(value: AuthenticatedApiActor | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
