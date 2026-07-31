import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { invoiceLineTax, tax } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { operationForTaxKind, taxKindSchema, taxPatchSchema } from "@/server/taxes/schema";

async function getSettingsContext() {
  const session = await getUserSession();
  if (!session?.user) return { error: NextResponse.json({ message: "No autorizado." }, { status: 401 }) } as const;
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) {
    return { error: NextResponse.json({ message: "Sin permisos." }, { status: 403 }) } as const;
  }
  return { ctx } as const;
}

function taxWriteError(error: unknown) {
  const databaseError = error as { code?: string };
  if (databaseError?.code === "23505") return "Ya existe un impuesto con ese nombre.";
  return "No se pudo actualizar el impuesto.";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getSettingsContext();
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = taxPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Los datos no son válidos." }, { status: 400 });
  }

  const [current] = await db.select().from(tax).where(and(eq(tax.id, id), eq(tax.companyId, auth.ctx.company.id))).limit(1);
  if (!current) return NextResponse.json({ message: "Impuesto no encontrado." }, { status: 404 });

  const values = parsed.data;
  const nextKind = taxKindSchema.parse(values.kind ?? current.kind);
  const nextOperation = operationForTaxKind(nextKind, values.operation ?? (current.operation === "SUBTRACT" ? "SUBTRACT" : "ADD"));
  try {
    const [updated] = await db.update(tax).set({
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.rate !== undefined ? { rate: values.rate.toFixed(3) } : {}),
      ...(values.kind !== undefined ? { kind: nextKind } : {}),
      ...(values.kind !== undefined || values.operation !== undefined ? { operation: nextOperation } : {}),
      ...(values.isDefault !== undefined ? { isDefault: values.isDefault } : {}),
      ...(values.isActive !== undefined ? { isActive: values.isActive } : {}),
      updatedAt: new Date(),
    }).where(and(eq(tax.id, id), eq(tax.companyId, auth.ctx.company.id))).returning();
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ message: taxWriteError(error) }, { status: 409 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getSettingsContext();
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const [current] = await db.select({ id: tax.id }).from(tax).where(and(eq(tax.id, id), eq(tax.companyId, auth.ctx.company.id))).limit(1);
  if (!current) return NextResponse.json({ message: "Impuesto no encontrado." }, { status: 404 });

  const [usage] = await db.select({ count: sql<number>`count(*)::int` }).from(invoiceLineTax).where(eq(invoiceLineTax.taxId, id));
  if ((usage?.count ?? 0) > 0) {
    const [archived] = await db.update(tax).set({ isActive: false, isDefault: false, updatedAt: new Date() }).where(eq(tax.id, id)).returning();
    return NextResponse.json({ data: archived, archived: true, message: "El impuesto se ha archivado porque ya figura en facturas." });
  }

  await db.delete(tax).where(and(eq(tax.id, id), eq(tax.companyId, auth.ctx.company.id)));
  return NextResponse.json({ deleted: true, archived: false, message: "Impuesto eliminado." });
}
