import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { postBankTransaction } from "@/server/accounting/auto-post";
import { createBankTransaction, listBankTransactions } from "@/server/treasury/service";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await listBankTransactions(ctx.company.id));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await request.json()) as { bankAccountId?: string; amount?: string; description?: string; postedAt?: string };
  if (!payload.bankAccountId || !payload.amount || !payload.description || !payload.postedAt) {
    return NextResponse.json({ message: "Faltan datos obligatorios." }, { status: 400 });
  }
  const created = await createBankTransaction(ctx.company.id, ctx.tenant.id, session.user.id, {
    bankAccountId: payload.bankAccountId,
    amount: payload.amount,
    description: payload.description.trim(),
    postedAt: new Date(payload.postedAt),
  });
  await postBankTransaction({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    bankTransactionId: created.id,
    postedAt: new Date(payload.postedAt),
    reference: `Movimiento bancario ${created.id}`,
    amount: Number(payload.amount),
  });
  return NextResponse.json(created, { status: 201 });
}
