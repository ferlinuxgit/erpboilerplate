import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { deletePriceList, getPriceListDetail, updatePriceList } from "@/server/pricing/service";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1, "Indica el nombre de la tarifa.").max(80, "El nombre no puede superar 80 caracteres.").optional(),
  adjustmentPct: z.number().min(-100, "El ajuste no puede bajar del −100 %.").max(1000, "El ajuste no puede superar el 1000 %.").optional(),
  isActive: z.boolean().optional(),
  /** Precios propios por artículo: `price: null` quita el precio propio (vuelve al precio de venta con el ajuste). */
  prices: z
    .array(z.object({ itemId: z.string().trim().min(1), price: z.number().min(0, "Los precios no pueden ser negativos.").max(99_999_999).nullable() }))
    .max(5000, "Guarda como mucho 5000 precios de una vez.")
    .optional(),
});

/** Tarifa con los artículos y su precio propio (null = sin precio propio). */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { ctx } = await requirePermission("customer.read");
    const { id } = await params;
    const detail = await getPriceListDetail(ctx.company.id, id);
    if (!detail) return NextResponse.json({ message: "Tarifa no encontrada." }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    return handleRouteError(error, "price-lists.get", "No se pudo cargar la tarifa.");
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { ctx, user } = await requirePermission("settings.manage");
    const { id } = await params;
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = updateSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const saved = await updatePriceList({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id, parsed.data);
    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error, "price-lists.update", "No se pudo guardar la tarifa.");
  }
}

/** Borra la tarifa: los clientes y grupos que la usaban vuelven al precio de venta. */
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { ctx, user } = await requirePermission("settings.manage");
    const { id } = await params;
    await deletePriceList({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "price-lists.delete", "No se pudo borrar la tarifa.");
  }
}
