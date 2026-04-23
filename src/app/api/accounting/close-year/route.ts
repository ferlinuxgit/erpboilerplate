import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { fiscalYear } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { postYearEndClosing } from "@/server/accounting/auto-post";

export async function POST() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  await postYearEndClosing({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    fiscalYearId: ctx.fiscalYear.id,
  });
  const [closed] = await db
    .update(fiscalYear)
    .set({ isClosed: true })
    .where(and(eq(fiscalYear.id, ctx.fiscalYear.id), eq(fiscalYear.companyId, ctx.company.id)))
    .returning();
  return NextResponse.json(closed);
}
