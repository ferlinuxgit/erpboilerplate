import argon2 from "argon2";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiKey } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "apiKey.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(
    await db
      .select({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt, revokedAt: apiKey.revokedAt })
      .from(apiKey)
      .where(eq(apiKey.tenantId, ctx.tenant.id))
      .orderBy(desc(apiKey.createdAt)),
  );
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "apiKey.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as { name?: string } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.name?.trim()) return NextResponse.json({ message: "Nombre obligatorio." }, { status: 400 });
  const plainKey = `ak_${crypto.randomUUID().replaceAll("-", "")}`;
  const keyHash = await argon2.hash(plainKey);
  const [created] = await db
    .insert(apiKey)
    .values({ tenantId: ctx.tenant.id, name: payload.name.trim(), keyHash })
    .returning({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt, revokedAt: apiKey.revokedAt });
  await recordAudit({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    action: "apiKey.create",
    entityName: "apiKey",
    entityId: created.id,
    payload: { name: created.name },
  });
  return NextResponse.json({ ...created, plainKey }, { status: 201 });
}
