import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { getLowStockAlerts } from "@/server/inventory/service";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const alerts = await getLowStockAlerts(tenantContext.company.id);
  return NextResponse.json(alerts);
}
