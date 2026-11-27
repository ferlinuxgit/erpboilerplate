import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { disposeFixedAssetSchema } from "@/server/fixed-assets/schemas";
import { disposeFixedAsset, undoDisposal } from "@/server/fixed-assets/service";

/**
 * Baja o venta de un bien: amortiza hasta la fecha de baja y genera el asiento que da de baja su
 * valor y su amortización acumulada, con el resultado en 67x (pérdida) o 77x (beneficio).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = disposeFixedAssetSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const { id } = await params;
    const result = await disposeFixedAsset({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "fixed-assets.dispose", "No se pudo dar de baja el bien. Inténtalo de nuevo.");
  }
}

/** Anula la baja del bien con un contraasiento; el bien vuelve a estar en uso. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const { id } = await params;
    const result = await undoDisposal({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id, new Date().toISOString().slice(0, 10));
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "fixed-assets.dispose.undo", "No se pudo anular la baja. Inténtalo de nuevo.");
  }
}
