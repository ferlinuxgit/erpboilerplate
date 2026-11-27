import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { payrollActor, todayIso } from "@/server/payroll/http";
import { postSlip, unpostSlip } from "@/server/payroll/service";

/** Contabiliza la nómina: 640 y 642 al debe; 4751, 476, 460 y 465 al haber, con fecha de devengo. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const { id } = await params;
    return NextResponse.json(await postSlip(actor, id));
  } catch (error) {
    return handleRouteError(error, "payroll.slips.post", "No se pudo contabilizar la nómina. Inténtalo de nuevo.");
  }
}

/** Anula el asiento de la nómina con un contraasiento y la deja en borrador. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const { id } = await params;
    return NextResponse.json(await unpostSlip(actor, id, todayIso()));
  } catch (error) {
    return handleRouteError(error, "payroll.slips.unpost", "No se pudo anular el asiento de la nómina. Inténtalo de nuevo.");
  }
}
