import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { updateSubaccountLength } from "@/server/accounting/service";
import { isValidSubaccountLength } from "@/server/accounting/subaccounts-model";

/** Longitud de las subcuentas (8–12). Solo se puede cambiar mientras la empresa no tenga asientos. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireContext("settings.manage");
    const payload = (await readJsonBody(request)) as { subaccountLength?: unknown } | null;
    if (!payload) return invalidJsonResponse();
    const length = Number(payload.subaccountLength);
    if (!isValidSubaccountLength(length)) return jsonError(400, "La longitud de las subcuentas debe estar entre 8 y 12 dígitos.");
    const result = await updateSubaccountLength(ctx.company.id, ctx.tenant.id, ctx.user.id, length);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return handleRouteError(error, "accounting.subaccountLength", "No se pudo cambiar la longitud de las subcuentas.");
  }
}
