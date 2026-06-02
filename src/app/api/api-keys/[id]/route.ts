import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiKey } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";

async function requireApiKeyWriteContext() {
  const session = await getUserSession();
  if (!session?.user) return { error: NextResponse.json({ message: "No autorizado." }, { status: 401 }) };
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "apiKey.write")) return { error: NextResponse.json({ message: "Sin permisos." }, { status: 403 }) };
  return { ctx, session };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiKeyWriteContext();
  if (auth.error) return auth.error;

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
      actorUserId: auth.session.user.id,
      action: "apiKey.revoke",
      entityName: "apiKey",
      entityId: id,
      payload: { name: current.name },
    });

    return NextResponse.json(updated);
  }

  if (payload.action === "rotate") {
    const plainKey = `ak_${crypto.randomUUID().replaceAll("-", "")}`;
    const keyHash = await argon2.hash(plainKey);
    const [updated] = await db
      .update(apiKey)
      .set({ keyHash, revokedAt: null })
      .where(and(eq(apiKey.id, id), eq(apiKey.tenantId, auth.ctx.tenant.id)))
      .returning({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt, revokedAt: apiKey.revokedAt });

    await recordAudit({
      tenantId: auth.ctx.tenant.id,
      companyId: auth.ctx.company.id,
      actorUserId: auth.session.user.id,
      action: "apiKey.rotate",
      entityName: "apiKey",
      entityId: id,
      payload: { name: current.name },
    });

    return NextResponse.json({ ...updated, plainKey });
  }

  return NextResponse.json({ message: "Acción no soportada." }, { status: 400 });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiKeyWriteContext();
  if (auth.error) return auth.error;

  const { id } = await params;
  const [deleted] = await db
    .delete(apiKey)
    .where(and(eq(apiKey.id, id), eq(apiKey.tenantId, auth.ctx.tenant.id)))
    .returning({ id: apiKey.id, name: apiKey.name });

  if (!deleted) return NextResponse.json({ message: "API key no encontrada." }, { status: 404 });

  await recordAudit({
    tenantId: auth.ctx.tenant.id,
    companyId: auth.ctx.company.id,
    actorUserId: auth.session.user.id,
    action: "apiKey.delete",
    entityName: "apiKey",
    entityId: deleted.id,
    payload: { name: deleted.name },
  });

  return NextResponse.json({ ok: true });
}
