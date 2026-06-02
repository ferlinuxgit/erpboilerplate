import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deleteBankTransaction, getBankTransaction, updateBankTransaction } from "@/server/treasury/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const data = await getBankTransaction(ctx.company.id, id);
  if (!data) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as { bankAccountId?: string; amount?: string; description?: string; postedAt?: string } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.bankAccountId || !payload.amount || !payload.description || !payload.postedAt) {
    return NextResponse.json({ message: "Faltan datos obligatorios." }, { status: 400 });
  }
  const postedAt = new Date(payload.postedAt);
  const amount = Number(payload.amount);
  if (Number.isNaN(postedAt.getTime()) || !Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ message: "Fecha o importe inválidos." }, { status: 400 });
  }
  const { id } = await params;
  const updated = await updateBankTransaction(ctx.company.id, ctx.tenant.id, session.user.id, id, {
    bankAccountId: payload.bankAccountId,
    amount: payload.amount,
    description: payload.description.trim(),
    postedAt,
  });
  if (!updated) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const deleted = await deleteBankTransaction(ctx.company.id, ctx.tenant.id, session.user.id, id);
  if (!deleted) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
