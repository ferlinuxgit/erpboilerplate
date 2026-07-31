import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { bankAccount, paymentMethod } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { paymentMethodPayloadSchema } from "@/server/schemas/payment-methods";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = paymentMethodPayloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { id } = await params;

  const [existing] = await db.select({ id: paymentMethod.id }).from(paymentMethod)
    .where(and(eq(paymentMethod.id, id), eq(paymentMethod.companyId, ctx.company.id))).limit(1);
  if (!existing) return NextResponse.json({ message: "Forma de pago no encontrada." }, { status: 404 });

  const selectedBankAccountId = parsed.data.type === "BANK_TRANSFER" ? parsed.data.bankAccountId?.trim() || null : null;
  const [account] = selectedBankAccountId
    ? await db.select({ id: bankAccount.id, iban: bankAccount.iban }).from(bankAccount)
      .where(and(eq(bankAccount.id, selectedBankAccountId), eq(bankAccount.companyId, ctx.company.id))).limit(1)
    : [];
  if (selectedBankAccountId && !account) {
    return NextResponse.json({ message: "La cuenta bancaria seleccionada no pertenece a la empresa." }, { status: 400 });
  }

  try {
    const updated = await db.transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.update(paymentMethod).set({ isDefault: false, updatedAt: new Date() }).where(eq(paymentMethod.companyId, ctx.company.id));
      }
      const [row] = await tx.update(paymentMethod).set({
        bankAccountId: account?.id ?? null,
        code: parsed.data.code,
        name: parsed.data.name,
        type: parsed.data.type,
        bankAccountNumber: parsed.data.type === "BANK_TRANSFER" ? account?.iban ?? (parsed.data.bankAccountNumber?.trim() || null) : null,
        isDefault: parsed.data.isDefault,
        updatedAt: new Date(),
      }).where(and(eq(paymentMethod.id, id), eq(paymentMethod.companyId, ctx.company.id))).returning();
      await recordAudit({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        action: "payment_method.update",
        entityName: "paymentMethod",
        entityId: id,
        payload: { code: row.code, name: row.name, type: row.type, isDefault: row.isDefault },
      }, tx);
      return row;
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ message: "No se pudo guardar. Comprueba que el código no esté repetido." }, { status: 409 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx.delete(paymentMethod)
      .where(and(eq(paymentMethod.id, id), eq(paymentMethod.companyId, ctx.company.id)))
      .returning({ id: paymentMethod.id, name: paymentMethod.name });
    if (!row) return null;
    await recordAudit({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      action: "payment_method.delete",
      entityName: "paymentMethod",
      entityId: id,
      payload: { name: row.name },
    }, tx);
    return row;
  });
  if (!deleted) return NextResponse.json({ message: "Forma de pago no encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
