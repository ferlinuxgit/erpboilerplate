import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { createPriceList, listPriceLists } from "@/server/pricing/service";

const createSchema = z.object({
  code: z.string().trim().min(1, "Indica un código corto (por ejemplo, MAY).").max(12, "El código no puede superar 12 caracteres."),
  name: z.string().trim().min(1, "Indica el nombre de la tarifa.").max(80, "El nombre no puede superar 80 caracteres."),
  adjustmentPct: z.number().min(-100, "El ajuste no puede bajar del −100 %.").max(1000, "El ajuste no puede superar el 1000 %.").optional(),
});

/** Tarifas de precios de venta de la empresa, con el número de artículos con precio propio. */
export async function GET() {
  try {
    const { ctx } = await requirePermission("customer.read");
    return NextResponse.json(await listPriceLists(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "price-lists.list", "No se pudieron cargar las tarifas.");
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("settings.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const created = await createPriceList({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "price-lists.create", "No se pudo crear la tarifa.");
  }
}
