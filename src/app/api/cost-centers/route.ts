import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { costCenterInputSchema, createCostCenter, listCostCenters } from "@/server/cost-centers/service";

/** Centros de coste de la empresa (analítica), con el número de apuntes y bienes que los usan. */
export async function GET() {
  try {
    const { ctx } = await requirePermission("accounting.read");
    return NextResponse.json(await listCostCenters(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "cost-centers.list", "No se pudieron cargar los centros de coste.");
  }
}

/** Da de alta un centro de coste (código y nombre). */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = costCenterInputSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const created = await createCostCenter({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "cost-centers.create", "No se pudo crear el centro de coste.");
  }
}
