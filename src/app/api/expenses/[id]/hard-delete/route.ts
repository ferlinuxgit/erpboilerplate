import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deleteVoidedExpenseInvoice } from "@/server/supplier-invoices/service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos para eliminar gastos." }, { status: 403 });
  const { id } = await params;
  try {
    const deleted = await deleteVoidedExpenseInvoice({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      id,
    });
    if (!deleted) return NextResponse.json({ message: "Gasto no encontrado." }, { status: 404 });
    return NextResponse.json({ deleted: true, id: deleted.id, number: deleted.number });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar el gasto.";
    return NextResponse.json({ message }, { status: 409 });
  }
}
