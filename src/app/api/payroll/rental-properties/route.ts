import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { rentalPropertySchema } from "@/server/payroll/schemas";
import { createRentalProperty, listRentalProperties } from "@/server/payroll/service";

/** Inmuebles alquilados a cada arrendador (referencia catastral y situación para el modelo 180). */
export async function GET() {
  try {
    const { ctx, user } = await requirePermission("accounting.read");
    const actor = payrollActor(ctx, user);
    return NextResponse.json(await listRentalProperties(actor.companyId));
  } catch (error) {
    return handleRouteError(error, "payroll.rental-properties.list", "No se pudieron cargar los inmuebles.");
  }
}

/** Da de alta el inmueble alquilado a un proveedor arrendador. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, rentalPropertySchema);
    if ("response" in body) return body.response;
    return NextResponse.json(await createRentalProperty(actor, body.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "payroll.rental-properties.create", "No se pudo guardar el inmueble. Inténtalo de nuevo.");
  }
}
