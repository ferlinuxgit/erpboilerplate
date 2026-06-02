import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deleteBankAccount, getBankAccount, updateBankAccount } from "@/server/treasury/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const data = await getBankAccount(ctx.company.id, id);
  if (!data) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as { iban?: string; bankName?: string } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.iban?.trim() || !payload.bankName?.trim()) return NextResponse.json({ message: "Datos invalidos." }, { status: 400 });
  const { id } = await params;
  const updated = await updateBankAccount(ctx.company.id, ctx.tenant.id, session.user.id, id, {
    iban: payload.iban.trim(),
    bankName: payload.bankName.trim(),
  });
  if (!updated) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const deleted = await deleteBankAccount(ctx.company.id, ctx.tenant.id, session.user.id, id);
  if (!deleted) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
