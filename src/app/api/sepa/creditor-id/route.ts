import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { getSepaCreditorId, updateSepaCreditorId } from "@/server/sepa/creditor";

const payloadSchema = z.object({ creditorId: z.string().trim().max(40).nullable() });

export async function GET() {
  try {
    const { ctx } = await requirePermission("settings.manage");
    return NextResponse.json(await getSepaCreditorId(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "sepa.creditor.get");
  }
}

/** Identificador de acreedor SEPA de la empresa (necesario para las remesas de recibos). */
export async function PUT(request: Request) {
  try {
    const { ctx, user } = await requirePermission("settings.manage", "Tu rol no permite cambiar los datos de la empresa.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Identificador de acreedor no válido." }, { status: 400 });
    return NextResponse.json(await updateSepaCreditorId({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id }, parsed.data.creditorId));
  } catch (error) {
    return handleRouteError(error, "sepa.creditor.update", "No se pudo guardar el identificador de acreedor.");
  }
}
