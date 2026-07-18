import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { warehouse } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";

const payloadSchema = z.object({ name: z.string().trim().min(1), code: z.string().trim().min(1) });

async function context() { const session = await getUserSession(); if (!session?.user) return null; return { session, ctx: await ensureUserTenant({ id: session.user.id, name: session.user.name }) }; }
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await context(); if (!auth) return NextResponse.json({ message: "No autorizado." }, { status: 401 }); if (!can(auth.ctx.membership.role, "stock.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 }); const { id } = await params; const [record] = await db.select().from(warehouse).where(and(eq(warehouse.id, id), eq(warehouse.companyId, auth.ctx.company.id))).limit(1); return record ? NextResponse.json(record) : NextResponse.json({ message: "Almacén no encontrado." }, { status: 404 }); }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await context(); if (!auth) return NextResponse.json({ message: "No autorizado." }, { status: 401 }); if (!can(auth.ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 }); const payload = await readJsonBody(request); if (!payload) return invalidJsonResponse(); const parsed = payloadSchema.safeParse(payload); if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 }); const { id } = await params; const [updated] = await db.update(warehouse).set(parsed.data).where(and(eq(warehouse.id, id), eq(warehouse.companyId, auth.ctx.company.id))).returning(); if (!updated) return NextResponse.json({ message: "Almacén no encontrado." }, { status: 404 }); await recordAudit({ tenantId: auth.ctx.tenant.id, companyId: auth.ctx.company.id, actorUserId: auth.session.user.id, action: "warehouse.update", entityName: "warehouse", entityId: id, payload: parsed.data }); return NextResponse.json(updated); }
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await context(); if (!auth) return NextResponse.json({ message: "No autorizado." }, { status: 401 }); if (!can(auth.ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 }); const { id } = await params; try { const [deleted] = await db.delete(warehouse).where(and(eq(warehouse.id, id), eq(warehouse.companyId, auth.ctx.company.id))).returning({ id: warehouse.id }); if (!deleted) return NextResponse.json({ message: "Almacén no encontrado." }, { status: 404 }); await recordAudit({ tenantId: auth.ctx.tenant.id, companyId: auth.ctx.company.id, actorUserId: auth.session.user.id, action: "warehouse.delete", entityName: "warehouse", entityId: id }); return NextResponse.json({ ok: true }); } catch { return NextResponse.json({ message: "No se puede eliminar un almacén con movimientos asociados." }, { status: 409 }); } }
