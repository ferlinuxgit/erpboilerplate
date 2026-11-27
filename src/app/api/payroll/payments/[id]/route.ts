import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { payrollActor, todayIso } from "@/server/payroll/http";
import { deletePayrollPayment } from "@/server/payroll/service";

/** Anula un pago de nóminas o de seguros sociales (contraasiento) y deja las nóminas pendientes de pago. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const { id } = await params;
    return NextResponse.json(await deletePayrollPayment(actor, id, todayIso(ctx.company.timezone)));
  } catch (error) {
    return handleRouteError(error, "payroll.payments.delete", "No se pudo anular el pago. Inténtalo de nuevo.");
  }
}
