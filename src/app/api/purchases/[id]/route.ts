import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { purchaseOrderStatuses } from "@/lib/document-pipelines";
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

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = z.object({
    number: z.string().trim().min(1, "El número es obligatorio."),
    status: z.enum(purchaseOrderStatuses),
    supplierName: z.string().trim().min(1, "El proveedor es obligatorio."),
    lines: z.array(z.object({ description: z.string().trim().min(1), itemId: z.string().trim().optional(), quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().nonnegative() })).min(1, "Añade al menos una línea."),
  }).safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const { id } = await params;
  try {
    const updated = await updatePurchaseOrder(tenantContext.company.id, tenantContext.tenant.id, session.user.id, id, {
      ...parsed.data,
    });
    if (!updated) return NextResponse.json({ message: "Pedido no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "PURCHASE_ORDER_LOCKED") {
      return NextResponse.json(
        { message: "No puedes editar un pedido con recepciones o facturas vinculadas." },
        { status: 409 },
      );
    }
    return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudo actualizar el pedido." }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(tenantContext.membership.role, "purchase.write")) {
    return NextResponse.json({ message: "Sin permisos para eliminar pedidos de compra." }, { status: 403 });
  }

  const { id } = await params;
  try {
    const deleted = await deletePurchaseOrder(tenantContext.company.id, tenantContext.tenant.id, session.user.id, id);
    if (!deleted) return NextResponse.json({ message: "Pedido no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "PURCHASE_ORDER_HAS_DEPENDENCIES") {
      return NextResponse.json(
        { message: "No puedes eliminar un pedido con recepciones o facturas vinculadas. Anúlalo para conservar la trazabilidad." },
        { status: 409 },
      );
    }
    throw error;
  }
}
