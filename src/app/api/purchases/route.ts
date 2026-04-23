import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createPurchaseOrder, listPurchaseOrders } from "@/server/purchases/service";

const payloadSchema = z.object({
  supplierName: z.string().trim().min(1),
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

  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const createdOrder = await createPurchaseOrder(tenantContext.company.id, tenantContext.tenant.id, session.user.id, {
    supplierName: parsed.data.supplierName,
    number: parsed.data.number || undefined,
    fiscalYearId: tenantContext.fiscalYear.id,
    lines: parsed.data.lines,
  });

  return NextResponse.json(createdOrder, { status: 201 });
}
