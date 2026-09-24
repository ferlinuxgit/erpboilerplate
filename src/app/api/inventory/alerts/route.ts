import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { getLowStockAlerts } from "@/server/inventory/service";

export async function GET() {
  try {
    const { ctx } = await requirePermission("stock.read");
    return NextResponse.json(await getLowStockAlerts(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "inventory.alerts");
  }
}
