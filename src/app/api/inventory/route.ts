import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { getStockSnapshot } from "@/server/inventory/service";

/**
 * Snapshot de stock de la empresa activa.
 *
 * El antiguo `POST /api/inventory` (creaba un artículo por llamada, sin control de
 * stock negativo ni auditoría) se ha eliminado: usa `POST /api/stock-movements`,
 * que valida propiedad de artículo/almacén y stock disponible.
 */
export async function GET() {
  try {
    const { ctx } = await requirePermission("stock.read");
    return NextResponse.json(await getStockSnapshot(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "inventory.snapshot");
  }
}
