import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { deliveryNote } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { convertOrderToDelivery } from "@/server/sales/service";

const payloadSchema = z.object({
  customerId: z.string().trim().min(1),
  warehouseId: z.string().trim().optional().or(z.literal("")),
  salesOrderId: z.string().trim().optional().or(z.literal("")),
  number: z.string().trim().optional().or(z.literal("")),
  issuedAt: z.string().trim().min(1),
  lines: z.array(z.object({ salesOrderLineId: z.string().trim().min(1), quantity: z.coerce.number().positive() })).min(1).optional(),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(deliveryNote).where(eq(deliveryNote.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  if (!parsed.data.salesOrderId) return NextResponse.json({ message: "El pedido de venta de origen es obligatorio." }, { status: 400 });
  try {
    const converted = await convertOrderToDelivery({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      fiscalYearId: ctx.fiscalYear.id,
      salesOrderId: parsed.data.salesOrderId,
      warehouseId: parsed.data.warehouseId || null,
      lines: parsed.data.lines,
    });
    return NextResponse.json(converted, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el albarán.";
    return NextResponse.json({ message }, { status: message.includes("no encontrado") ? 404 : 400 });
  }

}
