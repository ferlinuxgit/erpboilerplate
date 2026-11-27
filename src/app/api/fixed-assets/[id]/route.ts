import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { fixedAssetInputSchema } from "@/server/fixed-assets/schemas";
import { deleteFixedAsset, getFixedAsset, updateFixedAsset } from "@/server/fixed-assets/service";

/** Ficha de un bien: datos, cuentas, cuadro de amortización, dotaciones contabilizadas y asientos de baja. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx } = await requirePermission("accounting.read");
    const { id } = await params;
    const asset = await getFixedAsset(ctx.company.id, id);
    if (!asset) return NextResponse.json({ message: "Bien de inmovilizado no encontrado." }, { status: 404 });
    return NextResponse.json(asset);
  } catch (error) {
    return handleRouteError(error, "fixed-assets.get", "No se pudo cargar el bien.");
  }
}

/** Modifica un bien. Con amortizaciones contabilizadas o de baja solo admite cambios de descripción, notas y factura de origen. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = fixedAssetInputSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const { id } = await params;
    const updated = await updateFixedAsset({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id, parsed.data);
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "fixed-assets.update", "No se pudo guardar el bien. Inténtalo de nuevo.");
  }
}

/** Elimina un bien sin amortizaciones contabilizadas ni baja. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const { id } = await params;
    await deleteFixedAsset({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "fixed-assets.delete", "No se pudo eliminar el bien. Inténtalo de nuevo.");
  }
}
