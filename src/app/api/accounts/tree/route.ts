import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { getChartTree } from "@/server/accounting/chart-tree";
import { accountCodeParam, parseChartRequest } from "@/server/accounting/chart-tree-request";

/**
 * Árbol del plan contable con sumas del periodo.
 * - `?level=1|2|3|4|sub`: despliega hasta ese nivel (por defecto 2).
 * - `?parent=430`: solo los hijos directos (despliegue perezoso).
 * - `?q=`: coincidencias (código, atajo 43.1, nombre, tercero o NIF) con sus grupos.
 * - `?reveal=43000001`: además, la rama hasta esa cuenta.
 * - `?fy=&from=&to=&f=movements,nonzero,partners,blocked`: periodo y filtros.
 */
export async function GET(request: Request) {
  try {
    const { ctx } = await requirePermission("accounting.read");
    const params = new URL(request.url).searchParams;
    const { period, filters, depth } = await parseChartRequest(ctx.company.id, ctx.fiscalYear.id, params);
    const parent = params.get("parent");
    const parentCode = parent ? accountCodeParam(parent) : null;
    if (parent && !parentCode) return NextResponse.json({ message: "Código de cuenta no válido." }, { status: 400 });
    const tree = await getChartTree(ctx.company.id, {
      ...period.range,
      depth,
      parentCode,
      q: params.get("q")?.slice(0, 100) ?? null,
      reveal: accountCodeParam(params.get("reveal")),
      filters,
    });
    return NextResponse.json(tree);
  } catch (error) {
    return handleRouteError(error, "accounts.tree", "No se pudo cargar el plan contable.");
  }
}
