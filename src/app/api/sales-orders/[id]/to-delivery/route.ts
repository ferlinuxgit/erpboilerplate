import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { convertOrderToDelivery } from "@/server/sales/service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  try {
    const created = await convertOrderToDelivery({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      fiscalYearId: ctx.fiscalYear.id,
      salesOrderId: id,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "deliveryNote.create", "No se pudo generar el albarán.");
  }
}
