import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { invoicePayment, payment } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { registerInvoicePayment } from "@/server/invoices/payments";

const payloadSchema = z.object({
  invoiceId: z.string().trim().min(1),
  amountApplied: z.number().positive(),
  postedAt: z.string().trim().min(1),
  paymentMethodId: z.string().trim().min(1),
  /** Movimiento bancario del que nace el cobro: se concilia en la misma operación. */
  bankTransactionId: z.string().trim().min(1).optional(),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db
    .select({
      id: invoicePayment.id,
      companyId: invoicePayment.companyId,
      invoiceId: invoicePayment.invoiceId,
      paymentId: invoicePayment.paymentId,
      number: payment.number,
      amountApplied: invoicePayment.amountApplied,
      postedAt: payment.postedAt,
      createdAt: invoicePayment.createdAt,
    })
    .from(invoicePayment)
    .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
    .where(eq(invoicePayment.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const postedAt = new Date(parsed.data.postedAt);
  if (Number.isNaN(postedAt.getTime())) return NextResponse.json({ message: "Fecha inválida." }, { status: 400 });

  try {
    const applied = await registerInvoicePayment(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, activeFiscalYearId: ctx.fiscalYear.id },
      {
        invoiceId: parsed.data.invoiceId,
        amountApplied: parsed.data.amountApplied,
        postedAt,
        paymentMethodId: parsed.data.paymentMethodId,
        bankTransactionId: parsed.data.bankTransactionId,
      },
    );
    return NextResponse.json(applied, { status: 201 });
  } catch (error) {
    // Factura inexistente (404), borrador/anulada (409), saldo superado (400), periodo bloqueado, etc.
    return handleRouteError(error, "invoice-payments.create", "No se pudo registrar el cobro. Inténtalo de nuevo.");
  }
}
