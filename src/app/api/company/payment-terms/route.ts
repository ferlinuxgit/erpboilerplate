import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { updateDefaultPaymentTerms } from "@/server/company/billing-defaults";

/** Plazo de pago por defecto (días) para clientes sin plazo propio. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("settings.manage");
    const payload = (await readJsonBody(request)) as { paymentTermsDays?: unknown } | null;
    if (!payload) return invalidJsonResponse();
    const result = await updateDefaultPaymentTerms(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id },
      Number(payload.paymentTermsDays),
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "companySettings.paymentTerms", "No se pudo guardar el plazo de pago.");
  }
}
