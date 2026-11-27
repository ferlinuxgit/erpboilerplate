import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { undoLastDepreciation } from "@/server/fixed-assets/service";

/** Deshace la última amortización contabilizada del bien con un contraasiento. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const { id } = await params;
    const result = await undoLastDepreciation({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, id, new Date().toISOString().slice(0, 10));
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "fixed-assets.depreciation.undo", "No se pudo deshacer la amortización. Inténtalo de nuevo.");
  }
}
