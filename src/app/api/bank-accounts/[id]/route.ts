import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deleteBankAccount, getBankAccount, setBankAccountArchived, updateBankAccount } from "@/server/treasury/service";

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
  const payload = (await readJsonBody(request)) as { iban?: string; bankName?: string; accountId?: string | null; archived?: boolean; bic?: string | null } | null;
  if (!payload) return invalidJsonResponse();
  const { id } = await params;

  try {
    // Archivar / reactivar sin tocar el resto de datos.
    if (typeof payload.archived === "boolean" && payload.iban === undefined && payload.bankName === undefined) {
      const archived = await setBankAccountArchived(ctx.company.id, ctx.tenant.id, session.user.id, id, payload.archived);
      if (!archived) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
      return NextResponse.json(archived);
    }
    if (!payload.iban?.trim() || !payload.bankName?.trim()) return NextResponse.json({ message: "IBAN y banco son obligatorios." }, { status: 400 });
    const updated = await updateBankAccount(ctx.company.id, ctx.tenant.id, session.user.id, id, {
      iban: payload.iban.trim(),
      bankName: payload.bankName.trim(),
      ...(payload.accountId === undefined ? {} : { accountId: payload.accountId?.trim() || null }),
      ...(payload.bic === undefined ? {} : { bic: typeof payload.bic === "string" ? payload.bic : null }),
    });
    if (!updated) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "bank-accounts.update", "No se pudo actualizar la cuenta bancaria. Inténtalo de nuevo.");
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const deleted = await deleteBankAccount(ctx.company.id, ctx.tenant.id, session.user.id, id);
    if (!deleted) return NextResponse.json({ message: "Cuenta no encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "bank-accounts.delete", "No se pudo borrar la cuenta bancaria. Inténtalo de nuevo.");
  }
}
