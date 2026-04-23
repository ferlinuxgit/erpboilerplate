import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { convertQuoteToOrder } from "@/server/sales/service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  try {
    const created = await convertQuoteToOrder({
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
      quoteId: id,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudo convertir el presupuesto." }, { status: 400 });
  }
}
