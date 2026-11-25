import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { createCustomerGroup, listCustomerGroups } from "@/server/pricing/service";

const createSchema = z.object({
  code: z.string().trim().min(1, "Indica un código corto (por ejemplo, DIST).").max(12, "El código no puede superar 12 caracteres."),
  name: z.string().trim().min(1, "Indica el nombre del grupo.").max(80, "El nombre no puede superar 80 caracteres."),
  priceListId: z.string().trim().nullable().optional(),
  discountPct: z.number().min(0, "El descuento debe estar entre 0 y 100 %.").max(100, "El descuento debe estar entre 0 y 100 %.").optional(),
});

/** Grupos de clientes con su tarifa, descuento y número de clientes. */
export async function GET() {
  try {
    const { ctx } = await requirePermission("customer.read");
    return NextResponse.json(await listCustomerGroups(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "customer-groups.list", "No se pudieron cargar los grupos de clientes.");
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("settings.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const created = await createCustomerGroup({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "customer-groups.create", "No se pudo crear el grupo de clientes.");
  }
}
