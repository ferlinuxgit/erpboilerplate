import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { deleteCustomerGroup, updateCustomerGroup } from "@/server/pricing/service";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1, "Indica el nombre del grupo.").max(80, "El nombre no puede superar 80 caracteres.").optional(),
  priceListId: z.string().trim().nullable().optional(),
  discountPct: z.number().min(0, "El descuento debe estar entre 0 y 100 %.").max(100, "El descuento debe estar entre 0 y 100 %.").optional(),
});

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { ctx, user } = await requirePermission("settings.manage");
    const { id } = await params;
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = updateSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    return NextResponse.json(await updateCustomerGroup({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id, parsed.data));
  } catch (error) {
    return handleRouteError(error, "customer-groups.update", "No se pudo guardar el grupo de clientes.");
  }
}

/** Borra el grupo: sus clientes se quedan sin grupo (sin tarifa ni descuento de grupo). */
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { ctx, user } = await requirePermission("settings.manage");
    const { id } = await params;
    await deleteCustomerGroup({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "customer-groups.delete", "No se pudo borrar el grupo de clientes.");
  }
}
