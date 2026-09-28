import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { suggestNextSubaccount } from "@/server/accounting/chart-tree";
import { accountCodeParam } from "@/server/accounting/chart-tree-request";

/** Siguiente subcuenta libre bajo una cuenta (`?parent=430` → 43000013). */
export async function GET(request: Request) {
  try {
    const { ctx } = await requirePermission("accounting.read");
    const parent = accountCodeParam(new URL(request.url).searchParams.get("parent"));
    if (!parent) return NextResponse.json({ message: "Indica la cuenta padre (solo dígitos)." }, { status: 400 });
    const suggestion = await suggestNextSubaccount(ctx.company.id, parent);
    return NextResponse.json({ parentCode: suggestion?.parentCode ?? parent, code: suggestion?.code ?? null });
  } catch (error) {
    return handleRouteError(error, "accounts.nextCode", "No se pudo calcular la siguiente subcuenta.");
  }
}
