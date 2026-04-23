import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { exportKpisExcel } from "@/server/reporting/service";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const file = await exportKpisExcel(ctx.company.id);
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=\"kpis.xlsx\"",
    },
  });
}
