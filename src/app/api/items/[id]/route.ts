import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { item } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { recordAudit } from "@/server/audit";

const payloadSchema = z.object({ name: z.string().trim().min(1), sku: z.string().trim().min(1), isService: z.boolean(), salePrice: z.coerce.number().nonnegative(), costPrice: z.coerce.number().nonnegative(), minimumStock: z.coerce.number().nonnegative() });

type RouteContext = { params: Promise<{ id: string }> };

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { ctx } = await requirePermission("stock.read");
    const { id } = await params;
    const [record] = await db.select().from(item).where(and(eq(item.id, id), eq(item.companyId, ctx.company.id))).limit(1);
    if (!record) return jsonError(404, "Artículo no encontrado.");
    return NextResponse.json(record);
  } catch (error) {
    return handleRouteError(error, "item.get");
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { ctx, user } = await requirePermission("stock.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    const { id } = await params;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(item)
        .set({ name: parsed.data.name, sku: parsed.data.sku, isService: parsed.data.isService, salePrice: parsed.data.salePrice.toFixed(2), costPrice: parsed.data.costPrice.toFixed(2), minimumStock: parsed.data.minimumStock.toFixed(3), isActive: true })
        .where(and(eq(item.id, id), eq(item.companyId, ctx.company.id)))
        .returning();
      if (!row) return null;
      await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "item.update", entityName: "item", entityId: id, payload: parsed.data }, tx);
      return row;
    });
    if (!updated) return jsonError(404, "Artículo no encontrado.");
    return NextResponse.json(updated);
  } catch (error) {
    if (isUniqueViolation(error)) return jsonError(409, "Ya existe un artículo con ese SKU.");
    return handleRouteError(error, "item.update", "No se pudo actualizar el artículo.");
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { ctx, user } = await requirePermission("stock.write");
    const { id } = await params;
    const archived = await db.transaction(async (tx) => {
      const [row] = await tx.update(item).set({ isActive: false }).where(and(eq(item.id, id), eq(item.companyId, ctx.company.id))).returning({ id: item.id, name: item.name, sku: item.sku });
      if (!row) return null;
      await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "item.archive", entityName: "item", entityId: id, payload: { name: row.name, sku: row.sku } }, tx);
      return row;
    });
    if (!archived) return jsonError(404, "Artículo no encontrado.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "item.archive", "No se pudo archivar el artículo.");
  }
}
