import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { apiKey } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "apiKey.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  const [deleted] = await db
    .delete(apiKey)
    .where(and(eq(apiKey.id, id), eq(apiKey.tenantId, ctx.tenant.id)))
    .returning({ id: apiKey.id, name: apiKey.name });

  if (!deleted) return NextResponse.json({ message: "API key no encontrada." }, { status: 404 });

  await recordAudit({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    action: "apiKey.delete",
    entityName: "apiKey",
    entityId: deleted.id,
    payload: { name: deleted.name },
  });

  return NextResponse.json({ ok: true });
}
