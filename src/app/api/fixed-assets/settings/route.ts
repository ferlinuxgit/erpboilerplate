import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { fixedAssetSettingsSchema } from "@/server/fixed-assets/schemas";
import { getDepreciationFrequency, setDepreciationFrequency } from "@/server/fixed-assets/service";

/** Periodicidad de las dotaciones de amortización de la empresa (mensual o anual). */
export async function GET() {
  try {
    const { ctx } = await requirePermission("accounting.read");
    return NextResponse.json({ depreciationFrequency: await getDepreciationFrequency(ctx.company.id) });
  } catch (error) {
    return handleRouteError(error, "fixed-assets.settings.get", "No se pudieron cargar los ajustes de inmovilizado.");
  }
}

/** Cambia la periodicidad de las dotaciones. Lo ya contabilizado no se toca: el siguiente periodo lleva solo lo que falte. */
export async function PATCH(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = fixedAssetSettingsSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const result = await setDepreciationFrequency({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data.depreciationFrequency);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "fixed-assets.settings.update", "No se pudieron guardar los ajustes de inmovilizado.");
  }
}
