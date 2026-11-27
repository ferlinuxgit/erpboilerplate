import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { fiscalTimeZoneFor } from "@/lib/fiscal-spain";
import { requirePermission } from "@/lib/rbac-server";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { isWithholdingModelCode } from "@/server/fiscal/withholdings";
import { payrollActor } from "@/server/payroll/http";
import { loadWithholdingModel } from "@/server/payroll/withholding-data";

/**
 * Cálculo en vivo de un modelo de retenciones: `?code=111|115|123|190|180|193&period=2026-Q1`
 * (o `2026-04`; `2026` en los resúmenes anuales). Devuelve las casillas o los perceptores, el
 * cuadre anual, los avisos y el detalle de partidas del periodo.
 */
export async function GET(request: Request) {
  try {
    const { ctx, user } = await requirePermission("fiscal.read");
    const actor = payrollActor(ctx, user);
    const search = new URL(request.url).searchParams;
    const code = search.get("code") ?? "";
    const period = (search.get("period") ?? "").trim().toUpperCase();
    if (!isWithholdingModelCode(code)) return NextResponse.json({ message: "Modelo no soportado: usa 111, 115, 123, 190, 180 o 193." }, { status: 400 });
    const timeZone = fiscalTimeZoneFor(await getCompanyTaxTerritory(actor.companyId));
    const model = await loadWithholdingModel(actor.companyId, code, period, timeZone);
    if (!model) return NextResponse.json({ message: "Periodo no válido para ese modelo. Usa 2026-Q1, 2026-04 o 2026 según el modelo." }, { status: 400 });
    return NextResponse.json(model);
  } catch (error) {
    return handleRouteError(error, "payroll.models.get", "No se pudo calcular el modelo.");
  }
}
