import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { employeeModelo190ExtraSchema } from "@/server/payroll/schemas";
import { saveEmployeeModelo190Extra } from "@/server/payroll/service";

/** Guarda (o borra, con `data: null`) los datos adicionales de la clave A del 190 de un ejercicio. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, employeeModelo190ExtraSchema);
    if ("response" in body) return body.response;
    const { id } = await params;
    return NextResponse.json(await saveEmployeeModelo190Extra(actor, id, body.data));
  } catch (error) {
    return handleRouteError(error, "payroll.employees.model190", "No se pudieron guardar los datos del 190. Inténtalo de nuevo.");
  }
}
