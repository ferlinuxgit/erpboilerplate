import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deletePurchaseOrder, getPurchaseOrder, updatePurchaseOrder } from "@/server/purchases/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(tenantContext.membership.role, "purchase.read")) {
    return NextResponse.json({ message: "Sin permisos para ver pedidos de compra." }, { status: 403 });
  }

  const { id } = await params;
  const order = await getPurchaseOrder(tenantContext.company.id, id);
  if (!order) return NextResponse.json({ message: "Pedido no encontrado." }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(tenantContext.membership.role, "purchase.write")) {
    return NextResponse.json({ message: "Sin permisos para editar pedidos de compra." }, { status: 403 });
  }

  const payload = (await readJsonBody(request)) as { number?: string; status?: string } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.number?.trim() || !payload.status?.trim()) {
    return NextResponse.json({ message: "Debes informar número y estado." }, { status: 400 });
  }

  const { id } = await params;
  const updated = await updatePurchaseOrder(tenantContext.company.id, tenantContext.tenant.id, session.user.id, id, {
    number: payload.number.trim(),
    status: payload.status.trim(),
  });
  if (!updated) return NextResponse.json({ message: "Pedido no encontrado." }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(tenantContext.membership.role, "purchase.write")) {
    return NextResponse.json({ message: "Sin permisos para eliminar pedidos de compra." }, { status: 403 });
  }

  const { id } = await params;
  const deleted = await deletePurchaseOrder(tenantContext.company.id, tenantContext.tenant.id, session.user.id, id);
  if (!deleted) return NextResponse.json({ message: "Pedido no encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
