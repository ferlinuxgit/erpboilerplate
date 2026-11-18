import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { cancelTenantDeletion, requestTenantDeletion } from "@/server/tenant/lifecycle";

/** El propietario da de baja el espacio (30 días para anularla). */
export async function POST() {
  try {
    const { ctx, user } = await requirePermission("billing.write", "Solo el propietario puede dar de baja el espacio.");
    await requestTenantDeletion({ tenantId: ctx.tenant.id, actorUserId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "tenant.deletion.request", "No se pudo solicitar la baja.");
  }
}

/** Anula la baja durante el periodo de gracia. */
export async function DELETE() {
  try {
    const { ctx, user } = await requirePermission("billing.write", "Solo el propietario puede anular la baja.");
    await cancelTenantDeletion({ tenantId: ctx.tenant.id, actorUserId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "tenant.deletion.cancel", "No se pudo anular la baja.");
  }
}
