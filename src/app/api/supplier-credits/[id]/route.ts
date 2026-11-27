import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/rbac-server";
import { removeSupplierCreditApplication } from "@/server/supplier-invoices/credits";

/** Quita una compensación de abono (o una devolución por banco, revirtiendo su asiento). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission(null);
    if (!can(ctx.membership.role, "purchase.write") && !can(ctx.membership.role, "expense.write")) {
      return NextResponse.json({ message: "Sin permisos para modificar compensaciones de abonos." }, { status: 403 });
    }
    const { id } = await params;
    const removed = await removeSupplierCreditApplication({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id);
    if (!removed) return NextResponse.json({ message: "Compensación no encontrada." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return handleRouteError(error, "supplier-credits.delete", "No se pudo quitar la compensación. Inténtalo de nuevo.");
  }
}
