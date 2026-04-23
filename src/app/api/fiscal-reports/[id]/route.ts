import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deleteFiscalReport, getFiscalReport, updateFiscalReport } from "@/server/fiscal/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "fiscal.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const report = await getFiscalReport(ctx.company.id, id);
  if (!report) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
  return NextResponse.json(report);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "fiscal.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await request.json()) as { code?: string; period?: string; status?: "DRAFT" | "READY" | "FILED" };
  if (!payload.code?.trim() || !payload.period?.trim() || !payload.status) return NextResponse.json({ message: "Datos invalidos." }, { status: 400 });
  const { id } = await params;
  const updated = await updateFiscalReport(ctx.company.id, ctx.tenant.id, session.user.id, id, { code: payload.code.trim(), period: payload.period.trim(), status: payload.status });
  if (!updated) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "fiscal.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const deleted = await deleteFiscalReport(ctx.company.id, ctx.tenant.id, session.user.id, id);
  if (!deleted) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
