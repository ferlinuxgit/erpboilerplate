import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { autoReconcileBankTransactions } from "@/server/treasury/reconciliation";

export async function POST() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const result = await autoReconcileBankTransactions(ctx.company.id);
  await recordAudit({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    action: "treasury.reconcile.auto",
    entityName: "bankTransaction",
    entityId: ctx.company.id,
    payload: result,
  });
  return NextResponse.json(result);
}
