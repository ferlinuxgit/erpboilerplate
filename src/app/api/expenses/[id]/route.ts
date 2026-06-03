import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getExpenseInvoice, voidExpenseInvoice } from "@/server/supplier-invoices/service";

const voidSchema = z.object({
  reason: z.string().trim().optional().or(z.literal("")),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.read")) return NextResponse.json({ message: "Sin permisos para ver gastos." }, { status: 403 });
  const { id } = await params;
  const expense = await getExpenseInvoice(ctx.company.id, id);
  if (!expense) return NextResponse.json({ message: "Gasto no encontrado." }, { status: 404 });
  return NextResponse.json(expense);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos para anular gastos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = voidSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const { id } = await params;
  try {
    const updated = await voidExpenseInvoice({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      id,
      reason: parsed.data.reason || undefined,
    });
    if (!updated) return NextResponse.json({ message: "Gasto no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo anular el gasto.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
