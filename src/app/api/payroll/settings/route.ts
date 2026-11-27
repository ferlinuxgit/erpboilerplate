import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { payrollSettingsSchema } from "@/server/payroll/schemas";
import { savePayrollSettings } from "@/server/payroll/service";
import { getPayrollSettings } from "@/server/payroll/withholding-data";

/** Ajustes de retenciones: criterio de imputación y modelos activados a mano. */
export async function GET() {
  try {
    const { ctx, user } = await requirePermission("fiscal.read");
    const actor = payrollActor(ctx, user);
    return NextResponse.json(await getPayrollSettings(actor.companyId));
  } catch (error) {
    return handleRouteError(error, "payroll.settings.get", "No se pudieron cargar los ajustes.");
  }
}

/**
 * Guarda el criterio de imputación de las retenciones (facturas por fecha de registro o de pago;
 * nóminas por devengo o por pago) y los modelos que se quieren ver en el calendario sin datos.
 */
export async function PUT(request: Request) {
  try {
    const { ctx, user } = await requirePermission("fiscal.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, payrollSettingsSchema);
    if ("response" in body) return body.response;
    return NextResponse.json(await savePayrollSettings(actor, body.data));
  } catch (error) {
    return handleRouteError(error, "payroll.settings.update", "No se pudieron guardar los ajustes. Inténtalo de nuevo.");
  }
}
