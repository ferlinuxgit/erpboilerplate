import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiKey } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { recordAudit } from "@/server/audit";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return await updateApiKey(request, context);
  } catch (error) {
    return handleRouteError(error, "apiKey.update", "No se pudo actualizar la API key.");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return await deleteApiKey(request, context);
  } catch (error) {
    return handleRouteError(error, "apiKey.delete", "No se pudo eliminar la API key.");
  }
}

async function updateApiKey(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("apiKey.write");

  const payload = (await readJsonBody(request)) as { action?: string } | null;
  if (!payload) return invalidJsonResponse();

  const { id } = await params;
  const [current] = await db
    .select({ id: apiKey.id, name: apiKey.name })
    .from(apiKey)
    .where(and(eq(apiKey.id, id), eq(apiKey.tenantId, auth.ctx.tenant.id)))
    .limit(1);

  if (!current) return NextResponse.json({ message: "API key no encontrada." }, { status: 404 });

  if (payload.action === "revoke") {
    const [updated] = await db
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKey.id, id), eq(apiKey.tenantId, auth.ctx.tenant.id)))
      .returning({ id: apiKey.id, name: apiKey.name, revokedAt: apiKey.revokedAt });

    await recordAudit({
      tenantId: auth.ctx.tenant.id,
      companyId: auth.ctx.company.id,
      actorUserId: auth.user.id,
      action: "apiKey.revoke",
      entityName: "apiKey",
      entityId: id,
      payload: { name: current.name },
    });

    return NextResponse.json(updated);
  }

  if (payload.action === "rotate") {
    const keyPrefix = `ak_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const plainKey = `${keyPrefix}_${crypto.randomUUID().replaceAll("-", "")}`;
    const keyHash = await argon2.hash(plainKey);
    const [updated] = await db
      .update(apiKey)
      .set({ keyHash, keyPrefix, companyId: auth.ctx.company.id, createdAt: new Date(), revokedAt: null, lastUsedAt: null })
      .where(and(eq(apiKey.id, id), eq(apiKey.tenantId, auth.ctx.tenant.id)))
      .returning({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt, revokedAt: apiKey.revokedAt });

    await recordAudit({
      tenantId: auth.ctx.tenant.id,
      companyId: auth.ctx.company.id,
      actorUserId: auth.user.id,
      action: "apiKey.rotate",
      entityName: "apiKey",
      entityId: id,
      payload: { name: current.name },
    });

    return NextResponse.json({ ...updated, plainKey });
  }

  return NextResponse.json({ message: "Acción no soportada." }, { status: 400 });
}

async function deleteApiKey(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("apiKey.write");

  const { id } = await params;
  const [deleted] = await db
    .delete(apiKey)
    .where(and(eq(apiKey.id, id), eq(apiKey.tenantId, auth.ctx.tenant.id)))
    .returning({ id: apiKey.id, name: apiKey.name });

  if (!deleted) return NextResponse.json({ message: "API key no encontrada." }, { status: 404 });

  await recordAudit({
    tenantId: auth.ctx.tenant.id,
    companyId: auth.ctx.company.id,
    actorUserId: auth.user.id,
    action: "apiKey.delete",
    entityName: "apiKey",
    entityId: deleted.id,
    payload: { name: deleted.name },
  });

  return NextResponse.json({ ok: true });
}
