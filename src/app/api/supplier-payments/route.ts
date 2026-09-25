import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { supplierPayment } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { registerSupplierPayment } from "@/server/supplier-payments/service";

const payloadSchema = z.object({
  supplierInvoiceId: z.string().trim().optional().or(z.literal("")),
  supplierPartnerId: z.string().trim().optional().or(z.literal("")),
  amountApplied: z.number().positive(),
  postedAt: z.string().trim().min(1),
  paymentMethodId: z.string().trim().optional().or(z.literal("")),
  bankAccountId: z.string().trim().optional().or(z.literal("")),
  reference: z.string().trim().max(160).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  /** Movimiento bancario del que nace el pago: se concilia en la misma operación. */
  bankTransactionId: z.string().trim().min(1).optional(),
}).refine((value) => Boolean(value.supplierInvoiceId || value.supplierPartnerId), {
  message: "Debes indicar un proveedor o una factura.",
  path: ["supplierPartnerId"],
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.read") && !can(ctx.membership.role, "expense.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(supplierPayment).where(eq(supplierPayment.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.write") && !can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const postedAt = new Date(parsed.data.postedAt);
  if (Number.isNaN(postedAt.getTime())) return NextResponse.json({ message: "Fecha inválida." }, { status: 400 });

  try {
    const applied = await registerSupplierPayment(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, activeFiscalYearId: ctx.fiscalYear.id },
      {
        supplierInvoiceId: parsed.data.supplierInvoiceId || null,
        supplierPartnerId: parsed.data.supplierPartnerId || null,
        amountApplied: parsed.data.amountApplied,
        postedAt,
        paymentMethodId: parsed.data.paymentMethodId || null,
        bankAccountId: parsed.data.bankAccountId || null,
        reference: parsed.data.reference || null,
        notes: parsed.data.notes || null,
        bankTransactionId: parsed.data.bankTransactionId,
      },
    );
    return NextResponse.json({ payment: applied.payment, application: applied.application }, { status: 201 });
  } catch (error) {
    // Factura/proveedor inexistente (404), anulada (409), importe superior al pendiente (400),
    // periodo bloqueado, ejercicio cerrado, cuenta contable inexistente, etc.
    return handleRouteError(error, "supplier-payments.create", "No se pudo registrar el pago. Inténtalo de nuevo.");
  }
}
