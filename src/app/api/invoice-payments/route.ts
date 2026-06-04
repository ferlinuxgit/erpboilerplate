import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { invoice, invoicePayment, payment, paymentMethod } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { postCustomerPayment } from "@/server/accounting/auto-post";

const payloadSchema = z.object({
  invoiceId: z.string().trim().min(1),
  amountApplied: z.number().positive(),
  postedAt: z.string().trim().min(1),
  paymentMethodId: z.string().trim().min(1),
});

function toCents(value: number | string) {
  return Math.round(Number(value) * 100);
}

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(invoicePayment).where(eq(invoicePayment.companyId, ctx.company.id)));
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
    const applied = await db.transaction(async (tx) => {
      const [ownedInvoice] = await tx
        .select({ id: invoice.id, totalAmount: invoice.totalAmount })
        .from(invoice)
        .where(and(eq(invoice.id, parsed.data.invoiceId), eq(invoice.companyId, ctx.company.id)))
        .limit(1);
      if (!ownedInvoice) throw new Error("INVOICE_NOT_FOUND");

      const [ownedPaymentMethod] = await tx
        .select({ id: paymentMethod.id })
        .from(paymentMethod)
        .where(and(eq(paymentMethod.id, parsed.data.paymentMethodId), eq(paymentMethod.companyId, ctx.company.id)))
        .limit(1);
      if (!ownedPaymentMethod) throw new Error("PAYMENT_METHOD_NOT_FOUND");

      const appliedPayments = await tx
        .select({ amountApplied: invoicePayment.amountApplied })
        .from(invoicePayment)
        .where(and(eq(invoicePayment.invoiceId, parsed.data.invoiceId), eq(invoicePayment.companyId, ctx.company.id)));
      const paidCents = appliedPayments.reduce((total, entry) => total + toCents(entry.amountApplied), 0);
      const invoiceTotalCents = toCents(ownedInvoice.totalAmount);
      const amountCents = toCents(parsed.data.amountApplied);
      if (amountCents > Math.max(invoiceTotalCents - paidCents, 0)) throw new Error("INVOICE_OVERPAYMENT");

      const [createdPayment] = await tx
        .insert(payment)
        .values({
          companyId: ctx.company.id,
          invoiceId: parsed.data.invoiceId,
          paymentMethodId: parsed.data.paymentMethodId,
          amount: parsed.data.amountApplied.toFixed(2),
          postedAt,
        })
        .returning();

      const [appliedPayment] = await tx
        .insert(invoicePayment)
        .values({
          companyId: ctx.company.id,
          invoiceId: parsed.data.invoiceId,
          paymentId: createdPayment.id,
          amountApplied: parsed.data.amountApplied.toFixed(2),
        })
        .returning();

      await tx
        .update(invoice)
        .set({
          paymentStatus: paidCents + amountCents >= invoiceTotalCents ? "PAID" : "PARTIAL",
          updatedAt: new Date(),
        })
        .where(and(eq(invoice.id, parsed.data.invoiceId), eq(invoice.companyId, ctx.company.id)));

      await postCustomerPayment({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        paymentId: createdPayment.id,
        postedAt,
        reference: `Cobro factura ${parsed.data.invoiceId}`,
        amount: parsed.data.amountApplied,
        dbClient: tx,
      });

      return appliedPayment;
    });

    return NextResponse.json(applied, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "INVOICE_NOT_FOUND") {
      return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "INVOICE_OVERPAYMENT") {
      return NextResponse.json({ message: "El importe supera el saldo pendiente de la factura." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "PAYMENT_METHOD_NOT_FOUND") {
      return NextResponse.json({ message: "Forma de pago no encontrada." }, { status: 404 });
    }
    throw error;
  }
}
