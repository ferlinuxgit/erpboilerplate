import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deleteBankTransactionWithPosting, getBankTransaction, updateBankTransactionWithPosting } from "@/server/treasury/service";

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
  const payload = (await readJsonBody(request)) as { bankAccountId?: string; amount?: string | number; description?: string; postedAt?: string } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.bankAccountId || payload.amount === undefined || payload.amount === "" || !payload.description?.trim() || !payload.postedAt) {
    return NextResponse.json({ message: "Indica cuenta, fecha, importe y concepto del movimiento." }, { status: 400 });
  }
  const postedAt = new Date(payload.postedAt);
  const amount = Number(String(payload.amount).replace(",", "."));
  if (Number.isNaN(postedAt.getTime()) || !Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ message: "Fecha o importe inválidos. El importe no puede ser cero." }, { status: 400 });
  }
  const { id } = await params;
  try {
    const updated = await updateBankTransactionWithPosting(ctx.company.id, ctx.tenant.id, session.user.id, id, {
      bankAccountId: payload.bankAccountId,
      amount: amount.toFixed(2),
      description: payload.description.trim(),
      postedAt,
    });
    if (!updated) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "bank-transactions.update", "No se pudo actualizar el movimiento. Inténtalo de nuevo.");
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const deleted = await deleteBankTransactionWithPosting(ctx.company.id, ctx.tenant.id, session.user.id, id);
    if (!deleted) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "bank-transactions.delete", "No se pudo eliminar el movimiento. Inténtalo de nuevo.");
  }
}
