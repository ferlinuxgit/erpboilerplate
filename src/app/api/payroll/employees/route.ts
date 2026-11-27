import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { payrollEmployeeSchema } from "@/server/payroll/schemas";
import { createEmployee, listEmployees } from "@/server/payroll/service";

/** Trabajadores y administradores de la empresa (perceptores de nóminas). */
export async function GET() {
  try {
    const { ctx, user } = await requirePermission("accounting.read");
    const actor = payrollActor(ctx, user);
    return NextResponse.json(await listEmployees(actor.companyId));
  } catch (error) {
    return handleRouteError(error, "payroll.employees.list", "No se pudieron cargar los trabajadores.");
  }
}

/** Da de alta un trabajador (clave A del 190) o un administrador (clave E). */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, payrollEmployeeSchema);
    if ("response" in body) return body.response;
    return NextResponse.json(await createEmployee(actor, body.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "payroll.employees.create", "No se pudo dar de alta el trabajador. Inténtalo de nuevo.");
  }
}
