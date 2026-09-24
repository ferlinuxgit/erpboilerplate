import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { listBankTransactions, recordBankTransaction } from "@/server/treasury/service";

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

  try {
    const created = await db.transaction((tx) => recordBankTransaction(ctx.company.id, ctx.tenant.id, session.user.id, {
      bankAccountId: payload.bankAccountId as string,
      amount: amount.toFixed(2),
      description: (payload.description as string).trim(),
      postedAt,
    }, tx));
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "bank-transactions.create", "No se pudo registrar el movimiento. Inténtalo de nuevo.");
  }
}
