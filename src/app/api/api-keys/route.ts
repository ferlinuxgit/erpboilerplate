import argon2 from "argon2";
import { desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiKey } from "@/db/schema";
import { normalizeApiKeyScopes } from "@/lib/api-key-scopes";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { recordAudit } from "@/server/audit";

export async function GET() {
  try {
    const { ctx } = await requirePermission("apiKey.read");
    return NextResponse.json(
      await db
        // `legacy`: claves antiguas sin prefijo, que ya no autentican y deben rotarse.
        .select({ id: apiKey.id, name: apiKey.name, scopes: apiKey.scopes, createdAt: apiKey.createdAt, revokedAt: apiKey.revokedAt, legacy: isNull(apiKey.keyPrefix) })
        .from(apiKey)
        .where(eq(apiKey.tenantId, ctx.tenant.id))
        .orderBy(desc(apiKey.createdAt)),
    );
  } catch (error) {
    return handleRouteError(error, "apiKey.list");
  }
}

export async function POST(request: Request) {
  try {
    return await createApiKey(request);
  } catch (error) {
    return handleRouteError(error, "apiKey.create", "No se pudo crear la API key.");
  }
}

async function createApiKey(request: Request) {
  const { ctx, user } = await requirePermission("apiKey.write");
  const payload = (await readJsonBody(request)) as { name?: string; scopes?: unknown } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.name?.trim()) return NextResponse.json({ message: "Nombre obligatorio." }, { status: 400 });
  const scopes = normalizeApiKeyScopes(payload.scopes);
  if (scopes.length === 0) return NextResponse.json({ message: "Selecciona al menos un permiso para la API key." }, { status: 400 });
  const keyPrefix = `ak_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const plainKey = `${keyPrefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  const keyHash = await argon2.hash(plainKey);
  const [created] = await db
    .insert(apiKey)
    .values({ tenantId: ctx.tenant.id, companyId: ctx.company.id, keyPrefix, name: payload.name.trim(), scopes: JSON.stringify(scopes), keyHash })
    .returning({ id: apiKey.id, name: apiKey.name, scopes: apiKey.scopes, createdAt: apiKey.createdAt, revokedAt: apiKey.revokedAt });
  await recordAudit({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: user.id,
    action: "apiKey.create",
    entityName: "apiKey",
    entityId: created.id,
    payload: { name: created.name, scopes },
  });
  return NextResponse.json({ ...created, plainKey }, { status: 201 });
}
