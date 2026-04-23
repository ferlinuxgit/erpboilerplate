import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getTrialBalance } from "@/server/accounting/service";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.read")) {
    return NextResponse.json({ message: "Sin permisos de contabilidad." }, { status: 403 });
  }
  return NextResponse.json(await getTrialBalance(ctx.company.id));
}
