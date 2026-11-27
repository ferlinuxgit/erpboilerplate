import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { payrollActor } from "@/server/payroll/http";
import { deleteCapitalIncome } from "@/server/payroll/service";

/** Elimina un rendimiento pagado y anula su asiento (no se permite si su periodo ya está presentado). */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const { id } = await params;
    return NextResponse.json(await deleteCapitalIncome(actor, id));
  } catch (error) {
    return handleRouteError(error, "payroll.capital-income.delete", "No se pudo eliminar el rendimiento. Inténtalo de nuevo.");
  }
}
