import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { fixedAssetInputSchema } from "@/server/fixed-assets/schemas";
import { createFixedAsset, listFixedAssets } from "@/server/fixed-assets/service";

/** Bienes de inmovilizado de la empresa con su valor, lo amortizado y lo pendiente. */
export async function GET() {
  try {
    const { ctx } = await requirePermission("accounting.read");
    return NextResponse.json(await listFixedAssets(ctx.company.id, new Date().toISOString().slice(0, 10)));
  } catch (error) {
    return handleRouteError(error, "fixed-assets.list", "No se pudo cargar el inmovilizado.");
  }
}

/** Da de alta un bien de inmovilizado. Las cuentas se indican por código (217, 2817, 681) y se crean sus subcuentas si faltan. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = fixedAssetInputSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const created = await createFixedAsset({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "fixed-assets.create", "No se pudo dar de alta el bien. Inténtalo de nuevo.");
  }
}
