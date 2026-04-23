import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createBankAccount, listBankAccounts } from "@/server/treasury/service";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.read")) {
    return NextResponse.json({ message: "Sin permisos de tesoreria." }, { status: 403 });
  }
  return NextResponse.json(await listBankAccounts(ctx.company.id));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) {
    return NextResponse.json({ message: "Sin permisos de tesoreria." }, { status: 403 });
  }
  const payload = (await request.json()) as { iban?: string; bankName?: string };
  if (!payload.iban?.trim() || !payload.bankName?.trim()) {
    return NextResponse.json({ message: "IBAN y banco son obligatorios." }, { status: 400 });
  }
  const created = await createBankAccount(ctx.company.id, ctx.tenant.id, session.user.id, {
    iban: payload.iban.trim(),
    bankName: payload.bankName.trim(),
  });
  return NextResponse.json(created, { status: 201 });
}
