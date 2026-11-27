import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { rentalPropertySchema } from "@/server/payroll/schemas";
import { deleteRentalProperty, updateRentalProperty } from "@/server/payroll/service";

/** Modifica un inmueble alquilado. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, rentalPropertySchema);
    if ("response" in body) return body.response;
    const { id } = await params;
    return NextResponse.json(await updateRentalProperty(actor, id, body.data));
  } catch (error) {
    return handleRouteError(error, "payroll.rental-properties.update", "No se pudo guardar el inmueble. Inténtalo de nuevo.");
  }
}

/** Elimina un inmueble alquilado. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const { id } = await params;
    return NextResponse.json(await deleteRentalProperty(actor, id));
  } catch (error) {
    return handleRouteError(error, "payroll.rental-properties.delete", "No se pudo eliminar el inmueble. Inténtalo de nuevo.");
  }
}
