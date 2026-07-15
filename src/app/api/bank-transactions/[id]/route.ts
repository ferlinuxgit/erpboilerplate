import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { db } from "@/lib/db";
import { postBankTransaction, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
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
  const bankAccountId = payload.bankAccountId;
  const amountText = payload.amount;
  const description = payload.description.trim();
  const { id } = await params;
  try {
  const updated = await db.transaction(async (tx) => {
    const existing = await getBankTransaction(ctx.company.id, id, tx);
    if (!existing) return null;
    if (existing.reconciliationStatus === "RECONCILED") throw new Error("No se puede editar un movimiento conciliado.");
    await assertFiscalPeriodOpen(ctx.company.id, existing.postedAt, tx);
    await assertFiscalPeriodOpen(ctx.company.id, postedAt, tx);
    await reverseAutomaticEntries({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, postedAt, reference: `Corrección movimiento ${id}`, sourceType: "bankTransaction", sourceId: id, reason: `Reversión por edición del movimiento ${id}`, dbClient: tx });
    const changed = await updateBankTransaction(ctx.company.id, ctx.tenant.id, session.user.id, id, { bankAccountId, amount: amountText, description, postedAt }, tx);
    if (changed) await postBankTransaction({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, bankTransactionId: id, postedAt, reference: `Movimiento bancario ${id} corregido`, amount, dbClient: tx });
    return changed;
  });
  if (!updated) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
  return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudo actualizar el movimiento." }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
  const deleted = await db.transaction(async (tx) => {
    const existing = await getBankTransaction(ctx.company.id, id, tx);
    if (!existing) return false;
    if (existing.reconciliationStatus === "RECONCILED") throw new Error("No se puede eliminar un movimiento conciliado.");
    await assertFiscalPeriodOpen(ctx.company.id, existing.postedAt, tx);
    await reverseAutomaticEntries({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, postedAt: existing.postedAt, reference: `Eliminación movimiento ${id}`, sourceType: "bankTransaction", sourceId: id, reason: `Reversión por eliminación del movimiento ${id}`, dbClient: tx });
    return deleteBankTransaction(ctx.company.id, ctx.tenant.id, session.user.id, id, tx);
  });
  if (!deleted) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudo eliminar el movimiento." }, { status: 400 });
  }
}
