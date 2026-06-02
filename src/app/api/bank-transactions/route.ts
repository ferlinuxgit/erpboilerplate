import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
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
  const payload = (await readJsonBody(request)) as { bankAccountId?: string; amount?: string; description?: string; postedAt?: string } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.bankAccountId || !payload.amount || !payload.description || !payload.postedAt) {
    return NextResponse.json({ message: "Faltan datos obligatorios." }, { status: 400 });
  }
  const bankAccountId = payload.bankAccountId;
  const amountValue = payload.amount;
  const description = payload.description.trim();
  const postedAt = new Date(payload.postedAt);
  const amount = Number(amountValue);
  if (Number.isNaN(postedAt.getTime()) || !Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ message: "Fecha o importe inválidos." }, { status: 400 });
  }

  const created = await db.transaction(async (tx) => {
    const createdTransaction = await createBankTransaction(ctx.company.id, ctx.tenant.id, session.user.id, {
      bankAccountId,
      amount: amountValue,
      description,
      postedAt,
    }, tx);
    await postBankTransaction({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      bankTransactionId: createdTransaction.id,
      postedAt,
      reference: `Movimiento bancario ${createdTransaction.id}`,
      amount,
      dbClient: tx,
    });
    return createdTransaction;
  });
  return NextResponse.json(created, { status: 201 });
}
