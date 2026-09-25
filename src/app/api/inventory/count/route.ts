import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { postInventoryCount } from "@/server/inventory/count-sheet";

const payloadSchema = z.object({
  warehouseId: z.string().trim().min(1, "Elige el almacén."),
  countedAt: z.string().trim().min(1, "Indica la fecha del recuento."),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  lines: z
    .array(z.object({
      itemId: z.string().trim().min(1),
      countedQuantity: z.number().min(0, "Lo contado no puede ser negativo."),
      expectedQuantity: z.number(),
    }))
    .min(1, "Introduce al menos una cantidad contada.")
    .max(2000),
});

/** Registra una hoja de recuento: todos los ajustes en una operación auditada. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("stock.write", "Sin permisos para ajustar el stock.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos del recuento no válidos.");
    const countedAt = new Date(parsed.data.countedAt);
    if (Number.isNaN(countedAt.getTime())) return jsonError(400, "Fecha del recuento no válida.");
    const result = await postInventoryCount({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: user.id,
      warehouseId: parsed.data.warehouseId,
      countedAt,
      notes: parsed.data.notes || undefined,
      lines: parsed.data.lines,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "inventory.count.post", "No se pudo registrar el recuento.");
  }
}
