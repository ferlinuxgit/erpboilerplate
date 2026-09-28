import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { getAccountSummary } from "@/server/accounting/chart-tree";
import { parseChartRequest } from "@/server/accounting/chart-tree-request";

/** Ficha de la cuenta: sumas del periodo, evolución mensual frente al ejercicio anterior y últimos apuntes. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx } = await requirePermission("accounting.read");
    const { id } = await params;
    const { period } = await parseChartRequest(ctx.company.id, ctx.fiscalYear.id, new URL(request.url).searchParams);
    const summary = await getAccountSummary(ctx.company.id, id, period);
    if (!summary) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
    return NextResponse.json(summary);
  } catch (error) {
    return handleRouteError(error, "accounts.summary", "No se pudo cargar la ficha de la cuenta.");
  }
}
