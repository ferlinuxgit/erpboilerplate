import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { assertCorporateTaxCompany, deleteManualLoss } from "@/server/corporate-tax/service";

/** Borra una base negativa anotada a mano. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("fiscal.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { id } = await params;
    return NextResponse.json(await deleteManualLoss({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.losses.delete", "No se pudo borrar la base negativa.");
  }
}
