import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { updateDefaultAccounts } from "@/server/company/billing-defaults";

const code = z.string().trim().min(1);
const payloadSchema = z.object({ customer: code, supplier: code, sales: code, purchase: code, bank: code });

/** Cuentas de la contabilidad automática. Solo antes del primer asiento. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("settings.manage");
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return jsonError(400, "Indica las cinco cuentas (clientes, proveedores, ventas, compras y bancos).");
    const result = await updateDefaultAccounts({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "companySettings.defaultAccounts", "No se pudieron guardar las cuentas por defecto.");
  }
}
