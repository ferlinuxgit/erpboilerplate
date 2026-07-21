import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { bankAccount, partner, paymentMethod, purchaseOrder, supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { postSupplierPayment } from "@/server/accounting/auto-post";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { refreshSupplierInvoicePaymentStatus } from "@/server/supplier-invoices/service";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";

const payloadSchema = z.object({
  supplierInvoiceId: z.string().trim().optional().or(z.literal("")),
  supplierPartnerId: z.string().trim().optional().or(z.literal("")),
  amountApplied: z.number().positive(),
  postedAt: z.string().trim().min(1),
  paymentMethodId: z.string().trim().optional().or(z.literal("")),
  bankAccountId: z.string().trim().optional().or(z.literal("")),
  reference: z.string().trim().max(160).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
}).refine((value) => Boolean(value.supplierInvoiceId || value.supplierPartnerId), {
  message: "Debes indicar un proveedor o una factura.",
  path: ["supplierPartnerId"],
});

function toCents(value: number | string) {
  return Math.round(Number(value) * 100);
}

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
    const applied = await db.transaction(async (tx) => {
      const [ownedInvoice] = parsed.data.supplierInvoiceId
        ? await tx
          .select({
            id: supplierInvoice.id,
            supplierPartnerId: supplierInvoice.supplierPartnerId,
            origin: supplierInvoice.origin,
            purchaseOrderId: supplierInvoice.purchaseOrderId,
            totalAmount: supplierInvoice.totalAmount,
            status: supplierInvoice.status,
          })
          .from(supplierInvoice)
          .where(and(eq(supplierInvoice.id, parsed.data.supplierInvoiceId), eq(supplierInvoice.companyId, ctx.company.id)))
          .for("update")
          .limit(1)
        : [];
      if (parsed.data.supplierInvoiceId && !ownedInvoice) throw new Error("SUPPLIER_INVOICE_NOT_FOUND");
      if (ownedInvoice?.status === "VOID") throw new Error("SUPPLIER_INVOICE_VOID");
      if (ownedInvoice && parsed.data.supplierPartnerId && ownedInvoice.supplierPartnerId !== parsed.data.supplierPartnerId) {
        throw new Error("SUPPLIER_PAYMENT_PARTNER_MISMATCH");
      }

      const supplierPartnerId = ownedInvoice?.supplierPartnerId ?? parsed.data.supplierPartnerId;
      const [ownedSupplier] = supplierPartnerId
        ? await tx
          .select({ id: partner.id })
          .from(partner)
          .where(and(eq(partner.id, supplierPartnerId), eq(partner.companyId, ctx.company.id), inArray(partner.type, ["SUPPLIER", "BOTH"])))
          .limit(1)
        : [];
      if (!ownedSupplier) throw new Error("SUPPLIER_NOT_FOUND");

      await assertFiscalPeriodOpen(ctx.company.id, postedAt, tx);
      if (ownedInvoice?.origin === "EXPENSE" && !can(ctx.membership.role, "expense.write")) throw new Error("SUPPLIER_INVOICE_FORBIDDEN");
      if (ownedInvoice && ownedInvoice.origin !== "EXPENSE" && !can(ctx.membership.role, "purchase.write")) throw new Error("SUPPLIER_INVOICE_FORBIDDEN");

      const [ownedPaymentMethods, ownedBankAccounts] = await Promise.all([
        parsed.data.paymentMethodId
          ? tx.select({ id: paymentMethod.id }).from(paymentMethod).where(and(eq(paymentMethod.id, parsed.data.paymentMethodId), eq(paymentMethod.companyId, ctx.company.id))).limit(1)
          : Promise.resolve([]),
        parsed.data.bankAccountId
          ? tx.select({ id: bankAccount.id }).from(bankAccount).where(and(eq(bankAccount.id, parsed.data.bankAccountId), eq(bankAccount.companyId, ctx.company.id))).limit(1)
          : Promise.resolve([]),
      ]);
      if (parsed.data.paymentMethodId && !ownedPaymentMethods[0]) throw new Error("PAYMENT_METHOD_NOT_FOUND");
      if (parsed.data.bankAccountId && !ownedBankAccounts[0]) throw new Error("BANK_ACCOUNT_NOT_FOUND");

      if (ownedInvoice) {
        const appliedPayments = await tx
          .select({ amountApplied: supplierInvoicePayment.amountApplied })
          .from(supplierInvoicePayment)
          .where(and(eq(supplierInvoicePayment.supplierInvoiceId, ownedInvoice.id), eq(supplierInvoicePayment.companyId, ctx.company.id)));
        const paidCents = appliedPayments.reduce((total, entry) => total + toCents(entry.amountApplied), 0);
        const invoiceTotalCents = toCents(ownedInvoice.totalAmount);
        const amountCents = toCents(parsed.data.amountApplied);
        if (amountCents > Math.max(invoiceTotalCents - paidCents, 0)) throw new Error("SUPPLIER_INVOICE_OVERPAYMENT");
      }

      const number = await reserveSeriesNumber(tx, {
        companyId: ctx.company.id,
        fiscalYearId: ctx.fiscalYear.id,
        type: "PAYMENT",
        referenceDate: postedAt,
      });
      const [createdPayment] = await tx
        .insert(supplierPayment)
        .values({
          companyId: ctx.company.id,
          number,
          supplierPartnerId: ownedSupplier.id,
          supplierInvoiceId: ownedInvoice?.id ?? null,
          paymentMethodId: parsed.data.paymentMethodId || null,
          bankAccountId: parsed.data.bankAccountId || null,
          reference: parsed.data.reference || null,
          notes: parsed.data.notes || null,
          amount: parsed.data.amountApplied.toFixed(2),
          postedAt,
        })
        .returning();

      const [appliedPayment] = ownedInvoice
        ? await tx
          .insert(supplierInvoicePayment)
          .values({
            companyId: ctx.company.id,
            supplierInvoiceId: ownedInvoice.id,
            supplierPaymentId: createdPayment.id,
            amountApplied: parsed.data.amountApplied.toFixed(2),
          })
          .returning()
        : [];

      await postSupplierPayment({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        supplierPaymentId: createdPayment.id,
        postedAt,
        reference: parsed.data.reference || (ownedInvoice ? `Pago factura proveedor ${ownedInvoice.id}` : `Pago a cuenta de proveedor ${ownedSupplier.id}`),
        amount: parsed.data.amountApplied,
        dbClient: tx,
      });

      const refreshedInvoice = ownedInvoice
        ? await refreshSupplierInvoicePaymentStatus(ctx.company.id, ownedInvoice.id, tx)
        : null;
      if (refreshedInvoice?.paymentStatus === "PAID" && ownedInvoice?.purchaseOrderId) {
        const orderInvoices = await tx
          .select({ paymentStatus: supplierInvoice.paymentStatus, status: supplierInvoice.status })
          .from(supplierInvoice)
          .where(and(eq(supplierInvoice.companyId, ctx.company.id), eq(supplierInvoice.purchaseOrderId, ownedInvoice.purchaseOrderId)));
        const orderPaid =
          orderInvoices.length > 0 &&
          orderInvoices.every(
            (invoice) =>
              invoice.paymentStatus === "PAID" || invoice.status === "VOID",
          );
        if (orderPaid) {
          await tx
            .update(purchaseOrder)
            .set({ status: "PAID" })
            .where(and(eq(purchaseOrder.companyId, ctx.company.id), eq(purchaseOrder.id, ownedInvoice.purchaseOrderId)));
        }
      }

      await recordAudit({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        action: "supplier_payment.create",
        entityName: "supplier_payment",
        entityId: createdPayment.id,
        payload: {
          number: createdPayment.number,
          supplierPartnerId: ownedSupplier.id,
          supplierInvoiceId: ownedInvoice?.id ?? null,
          amount: parsed.data.amountApplied,
          paymentMethodId: parsed.data.paymentMethodId || null,
          bankAccountId: parsed.data.bankAccountId || null,
          reference: parsed.data.reference || null,
        },
      }, tx);

      return { payment: createdPayment, application: appliedPayment ?? null };
    });

    return NextResponse.json(applied, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_NOT_FOUND") {
      return NextResponse.json({ message: "Factura de proveedor no encontrada." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "SUPPLIER_NOT_FOUND") {
      return NextResponse.json({ message: "Proveedor no encontrado." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "SUPPLIER_PAYMENT_PARTNER_MISMATCH") {
      return NextResponse.json({ message: "La factura no pertenece al proveedor indicado." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_FORBIDDEN") {
      return NextResponse.json({ message: "Sin permisos para pagar esta factura de proveedor." }, { status: 403 });
    }
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_OVERPAYMENT") {
      return NextResponse.json({ message: "El importe supera el saldo pendiente de la factura de proveedor." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_VOID") return NextResponse.json({ message: "No se puede pagar una factura anulada." }, { status: 409 });
    if (error instanceof Error && error.message === "PAYMENT_METHOD_NOT_FOUND") return NextResponse.json({ message: "La forma de pago no pertenece a la empresa activa." }, { status: 400 });
    if (error instanceof Error && error.message === "BANK_ACCOUNT_NOT_FOUND") return NextResponse.json({ message: "La cuenta bancaria no pertenece a la empresa activa." }, { status: 400 });
    throw error;
  }
}
