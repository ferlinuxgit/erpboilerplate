import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { setAccountBlocked } from "@/server/accounting/service";

/** Bloquea (`{ "blocked": true }`) o desbloquea una subcuenta. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const payload: unknown = await readJsonBody(request);
    if (!payload || typeof payload !== "object") return invalidJsonResponse();
    const blocked = "blocked" in payload ? payload.blocked : undefined;
    if (typeof blocked !== "boolean") return NextResponse.json({ message: "Indica si la cuenta queda bloqueada." }, { status: 400 });
    const { id } = await params;
    const updated = await setAccountBlocked(ctx.company.id, ctx.tenant.id, user.id, id, blocked);
    if (!updated) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "accounts.block", "No se pudo cambiar el bloqueo de la cuenta.");
  }
}
