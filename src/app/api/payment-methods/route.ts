import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { bankAccount, paymentMethod } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { paymentMethodPayloadSchema, type PaymentMethodPayload } from "@/server/schemas/payment-methods";

async function resolveBankAccount(companyId: string, input: PaymentMethodPayload) {
  if (input.type !== "BANK_TRANSFER" || !input.bankAccountId?.trim()) return null;
  const [account] = await db.select({ id: bankAccount.id, iban: bankAccount.iban })
    .from(bankAccount)
    .where(and(eq(bankAccount.id, input.bankAccountId.trim()), eq(bankAccount.companyId, companyId)))
    .limit(1);
  return account ?? undefined;
}

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(paymentMethod)
    .where(eq(paymentMethod.companyId, ctx.company.id))
    .orderBy(desc(paymentMethod.isDefault), asc(paymentMethod.name)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = paymentMethodPayloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const account = await resolveBankAccount(ctx.company.id, parsed.data);
  if (parsed.data.type === "BANK_TRANSFER" && parsed.data.bankAccountId?.trim() && !account) {
    return NextResponse.json({ message: "La cuenta bancaria seleccionada no pertenece a la empresa." }, { status: 400 });
  }

  try {
    const created = await db.transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.update(paymentMethod).set({ isDefault: false, updatedAt: new Date() }).where(eq(paymentMethod.companyId, ctx.company.id));
      }
      const [row] = await tx.insert(paymentMethod).values({
        companyId: ctx.company.id,
        bankAccountId: account?.id ?? null,
        code: parsed.data.code,
        name: parsed.data.name,
        type: parsed.data.type,
        bankAccountNumber: parsed.data.type === "BANK_TRANSFER" ? account?.iban ?? (parsed.data.bankAccountNumber?.trim() || null) : null,
        isDefault: parsed.data.isDefault,
      }).returning();
      await recordAudit({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        action: "payment_method.create",
        entityName: "paymentMethod",
        entityId: row.id,
        payload: { code: row.code, name: row.name, type: row.type, isDefault: row.isDefault },
      }, tx);
      return row;
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ message: "No se pudo crear. Comprueba que el código no esté repetido." }, { status: 409 });
  }
}
