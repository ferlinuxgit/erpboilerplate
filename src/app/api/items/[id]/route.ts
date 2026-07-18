import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { item } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";

const payloadSchema = z.object({ name: z.string().trim().min(1), sku: z.string().trim().min(1), isService: z.boolean(), salePrice: z.coerce.number().nonnegative(), costPrice: z.coerce.number().nonnegative(), minimumStock: z.coerce.number().nonnegative() });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession(); if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name }); if (!can(ctx.membership.role, "stock.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params; const [record] = await db.select().from(item).where(and(eq(item.id, id), eq(item.companyId, ctx.company.id))).limit(1); if (!record) return NextResponse.json({ message: "Artículo no encontrado." }, { status: 404 }); return NextResponse.json(record);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession(); if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name }); if (!can(ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request); if (!payload) return invalidJsonResponse(); const parsed = payloadSchema.safeParse(payload); if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { id } = await params; const [updated] = await db.update(item).set({ name: parsed.data.name, sku: parsed.data.sku, isService: parsed.data.isService, salePrice: parsed.data.salePrice.toFixed(2), costPrice: parsed.data.costPrice.toFixed(2), minimumStock: parsed.data.minimumStock.toFixed(3) }).where(and(eq(item.id, id), eq(item.companyId, ctx.company.id))).returning(); if (!updated) return NextResponse.json({ message: "Artículo no encontrado." }, { status: 404 }); await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, action: "item.update", entityName: "item", entityId: id, payload: parsed.data }); return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession(); if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 }); const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name }); if (!can(ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 }); const { id } = await params;
  try { const [deleted] = await db.delete(item).where(and(eq(item.id, id), eq(item.companyId, ctx.company.id))).returning({ id: item.id }); if (!deleted) return NextResponse.json({ message: "Artículo no encontrado." }, { status: 404 }); await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, action: "item.delete", entityName: "item", entityId: id }); return NextResponse.json({ ok: true }); } catch { return NextResponse.json({ message: "No se puede eliminar un artículo con documentos o movimientos asociados." }, { status: 409 }); }
}
