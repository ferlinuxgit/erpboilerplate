import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createPurchaseOrder, listPurchaseOrders, PURCHASE_SUPPLIER_NOT_FOUND } from "@/server/purchases/service";

const payloadSchema = z.object({
  supplierPartnerId: z.string().trim().optional().or(z.literal("")),
  /** Compatibilidad: nombre exacto de un proveedor ya existente. */
  supplierName: z.string().trim().optional().or(z.literal("")),
  number: z.string().trim().optional().or(z.literal("")),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1),
        itemId: z.string().trim().optional().or(z.literal("")),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
      }),
    )
    .optional(),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(tenantContext.membership.role, "purchase.read")) {
    return NextResponse.json({ message: "Sin permisos para ver pedidos de compra." }, { status: 403 });
  }
  const data = await listPurchaseOrders(tenantContext.company.id);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const tenantContext = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(tenantContext.membership.role, "purchase.write")) {
    return NextResponse.json({ message: "Sin permisos para crear pedidos de compra." }, { status: 403 });
  }

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });
  if (!parsed.data.supplierPartnerId && !parsed.data.supplierName) return NextResponse.json({ message: "Elige el proveedor del pedido." }, { status: 400 });

  try {
    const createdOrder = await createPurchaseOrder(tenantContext.company.id, tenantContext.tenant.id, session.user.id, {
      supplierPartnerId: parsed.data.supplierPartnerId || undefined,
      supplierName: parsed.data.supplierName || undefined,
      number: parsed.data.number || undefined,
      fiscalYearId: tenantContext.fiscalYear.id,
      lines: parsed.data.lines,
    });

    return NextResponse.json(createdOrder, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === PURCHASE_SUPPLIER_NOT_FOUND) {
      return NextResponse.json({ message: "El proveedor no existe. Búscalo o créalo desde el selector antes de guardar el pedido." }, { status: 400 });
    }
    return handleRouteError(error, "purchases.create", "No se pudo crear el pedido de compra.");
  }
}
