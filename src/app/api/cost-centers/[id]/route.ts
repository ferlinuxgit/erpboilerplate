import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { costCenterInputSchema, deleteCostCenter, updateCostCenter } from "@/server/cost-centers/service";

/** Cambia el código, el nombre o el estado (activo / inactivo) de un centro de coste. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = costCenterInputSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const { id } = await params;
    const updated = await updateCostCenter({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id, parsed.data);
    if (!updated) return NextResponse.json({ message: "Centro de coste no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "cost-centers.update", "No se pudo guardar el centro de coste.");
  }
}

/** Borra un centro de coste sin apuntes ni bienes asignados. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const { id } = await params;
    const deleted = await deleteCostCenter({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id);
    if (!deleted) return NextResponse.json({ message: "Centro de coste no encontrado." }, { status: 404 });
    return NextResponse.json(deleted);
  } catch (error) {
    return handleRouteError(error, "cost-centers.delete", "No se pudo borrar el centro de coste.");
  }
}
