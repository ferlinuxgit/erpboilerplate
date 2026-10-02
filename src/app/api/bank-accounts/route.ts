import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
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
  const payload = (await readJsonBody(request)) as {
    kind?: string;
    iban?: string;
    bankName?: string;
    accountId?: string | null;
    bic?: string | null;
    paymentMethodId?: string | null;
  } | null;
  if (!payload) return invalidJsonResponse();

  const kind = payload.kind === "PAYMENT_PROVIDER" ? "PAYMENT_PROVIDER" : "BANK";
  if (!payload.bankName?.trim()) {
    return NextResponse.json({ message: kind === "BANK" ? "IBAN y banco son obligatorios." : "Indica el nombre de la pasarela." }, { status: 400 });
  }
  if (kind === "BANK" && !payload.iban?.trim()) {
    return NextResponse.json({ message: "IBAN y banco son obligatorios." }, { status: 400 });
  }
  try {
    const created = await createBankAccount(ctx.company.id, ctx.tenant.id, session.user.id, {
      kind,
      iban: kind === "BANK" ? payload.iban?.trim() : null,
      bankName: payload.bankName.trim(),
      accountId: payload.accountId?.trim() || null,
      bic: kind === "BANK" && typeof payload.bic === "string" ? payload.bic : null,
      paymentMethodId: kind === "PAYMENT_PROVIDER" ? payload.paymentMethodId?.trim() || null : null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "bank-accounts.create", "No se pudo crear la cuenta bancaria. Comprueba que el IBAN no esté ya dado de alta.");
  }
}
