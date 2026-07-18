import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { exportKpisExcel, type ReportingPeriod } from "@/server/reporting/service";

export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "reporting.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const requestedPeriod = new URL(request.url).searchParams.get("period");
  const period: ReportingPeriod = requestedPeriod === "quarter" || requestedPeriod === "year" ? requestedPeriod : "month";
  const file = await exportKpisExcel(ctx.company.id, period);
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="kpis-${period}.xlsx"`,
    },
  });
}
