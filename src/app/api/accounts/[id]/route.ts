import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deleteAccount, getAccount, updateAccount } from "@/server/accounting/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const account = await getAccount(ctx.company.id, id);
  if (!account) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
  return NextResponse.json(account);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as { code?: string; name?: string; type?: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.code?.trim() || !payload.name?.trim() || !payload.type) return NextResponse.json({ message: "Datos invalidos." }, { status: 400 });
  const { id } = await params;
  const updated = await updateAccount(ctx.company.id, ctx.tenant.id, session.user.id, id, { code: payload.code.trim(), name: payload.name.trim(), type: payload.type });
  if (!updated) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const deleted = await deleteAccount(ctx.company.id, ctx.tenant.id, session.user.id, id);
  if (!deleted) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
