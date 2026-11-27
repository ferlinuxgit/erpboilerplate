import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { payrollSlipSchema } from "@/server/payroll/schemas";
import { deleteSlip, updateSlip } from "@/server/payroll/service";

/** Modifica una nómina en borrador (una contabilizada hay que descontabilizarla antes). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, payrollSlipSchema);
    if ("response" in body) return body.response;
    const { id } = await params;
    return NextResponse.json(await updateSlip(actor, id, body.data));
  } catch (error) {
    return handleRouteError(error, "payroll.slips.update", "No se pudo guardar la nómina. Inténtalo de nuevo.");
  }
}

/** Elimina una nómina en borrador. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const { id } = await params;
    await deleteSlip(actor, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "payroll.slips.delete", "No se pudo eliminar la nómina. Inténtalo de nuevo.");
  }
}
