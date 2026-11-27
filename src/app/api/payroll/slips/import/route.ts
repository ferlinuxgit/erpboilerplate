import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { payrollImportSchema } from "@/server/payroll/schemas";
import { importSlips } from "@/server/payroll/service";

/**
 * Importa las nóminas de un mes pegadas desde una hoja de cálculo (NIF; Bruto; Especie; IRPF;
 * Ingreso a cuenta; SS trabajador; SS empresa; Anticipos; Líquido). Con `commit: false` solo las
 * comprueba y devuelve los errores de cada fila; con `commit: true` las crea (todas o ninguna).
 */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, payrollImportSchema);
    if ("response" in body) return body.response;
    return NextResponse.json(await importSlips(actor, body.data));
  } catch (error) {
    return handleRouteError(error, "payroll.slips.import", "No se pudieron importar las nóminas. Inténtalo de nuevo.");
  }
}
