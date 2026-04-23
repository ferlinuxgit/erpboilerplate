import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createFiscalReport, listFiscalReports } from "@/server/fiscal/service";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "fiscal.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await listFiscalReports(ctx.company.id));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "fiscal.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await request.json()) as { code?: string; period?: string; status?: "DRAFT" | "READY" | "FILED" };
  if (!payload.code?.trim() || !payload.period?.trim() || !payload.status) return NextResponse.json({ message: "Datos invalidos." }, { status: 400 });
  const created = await createFiscalReport(ctx.company.id, ctx.tenant.id, session.user.id, { code: payload.code.trim(), period: payload.period.trim(), status: payload.status });
  return NextResponse.json(created, { status: 201 });
}
