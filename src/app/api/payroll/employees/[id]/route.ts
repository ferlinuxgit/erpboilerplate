import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { payrollEmployeeSchema } from "@/server/payroll/schemas";
import { deleteEmployee, updateEmployee } from "@/server/payroll/service";

/** Modifica la ficha de un trabajador. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, payrollEmployeeSchema);
    if ("response" in body) return body.response;
    const { id } = await params;
    return NextResponse.json(await updateEmployee(actor, id, body.data));
  } catch (error) {
    return handleRouteError(error, "payroll.employees.update", "No se pudo guardar el trabajador. Inténtalo de nuevo.");
  }
}

/** Elimina un trabajador sin nóminas. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const { id } = await params;
    await deleteEmployee(actor, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "payroll.employees.delete", "No se pudo eliminar el trabajador. Inténtalo de nuevo.");
  }
}
