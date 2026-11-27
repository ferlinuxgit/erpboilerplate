import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { assertSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { setAnnualAccountsModel } from "@/server/accounting/annual-accounts/service";

const payloadSchema = z.object({ model: z.enum(["abbreviated", "pymes", "normal"]) });

/** Modelo de cuentas anuales que presenta la empresa: abreviado (por defecto), PYMES o normal. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireContext("accounting.write");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const body = await readJsonBody(request);
    if (!body) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Elige un modelo de cuentas anuales válido: abreviado, PYMES o normal.");
    await setAnnualAccountsModel({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: ctx.user.id, model: parsed.data.model });
    return NextResponse.json({ ok: true, model: parsed.data.model });
  } catch (error) {
    return handleRouteError(error, "accounting.annual-accounts.model", "No se pudo guardar el modelo de cuentas anuales.");
  }
}
