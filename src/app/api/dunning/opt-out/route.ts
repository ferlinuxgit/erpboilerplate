import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { setCustomerDunningOptOut } from "@/server/dunning/service";
import { dunningOptOutSchema } from "@/server/invoice-email/schemas";

/** Excluye (o vuelve a incluir) a un cliente de los recordatorios de cobro. */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("invoice.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = dunningOptOutSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Indica el cliente.");
    const result = await setCustomerDunningOptOut({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, parsed.data.customerId, parsed.data.optOut);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "dunning.optOut", "No se pudo guardar la preferencia del cliente.");
  }
}
