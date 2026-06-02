import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { postSupplierPayment } from "@/server/accounting/auto-post";

const payloadSchema = z.object({
  supplierInvoiceId: z.string().trim().min(1),
  amountApplied: z.number().positive(),
  postedAt: z.string().trim().min(1),
});

function toCents(value: number | string) {
  return Math.round(Number(value) * 100);
}

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(supplierInvoicePayment).where(eq(supplierInvoicePayment.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const postedAt = new Date(parsed.data.postedAt);
  if (Number.isNaN(postedAt.getTime())) return NextResponse.json({ message: "Fecha inválida." }, { status: 400 });

  try {
    const applied = await db.transaction(async (tx) => {
      const [ownedInvoice] = await tx
        .select({ id: supplierInvoice.id, totalAmount: supplierInvoice.totalAmount })
        .from(supplierInvoice)
        .where(and(eq(supplierInvoice.id, parsed.data.supplierInvoiceId), eq(supplierInvoice.companyId, ctx.company.id)))
        .limit(1);
      if (!ownedInvoice) throw new Error("SUPPLIER_INVOICE_NOT_FOUND");

      const appliedPayments = await tx
        .select({ amountApplied: supplierInvoicePayment.amountApplied })
        .from(supplierInvoicePayment)
        .where(and(eq(supplierInvoicePayment.supplierInvoiceId, parsed.data.supplierInvoiceId), eq(supplierInvoicePayment.companyId, ctx.company.id)));
      const paidCents = appliedPayments.reduce((total, entry) => total + toCents(entry.amountApplied), 0);
      const invoiceTotalCents = toCents(ownedInvoice.totalAmount);
      const amountCents = toCents(parsed.data.amountApplied);
      if (amountCents > Math.max(invoiceTotalCents - paidCents, 0)) throw new Error("SUPPLIER_INVOICE_OVERPAYMENT");

      const [createdPayment] = await tx
        .insert(supplierPayment)
        .values({
          companyId: ctx.company.id,
          supplierInvoiceId: parsed.data.supplierInvoiceId,
          amount: parsed.data.amountApplied.toFixed(2),
          postedAt,
        })
        .returning();

      const [appliedPayment] = await tx
        .insert(supplierInvoicePayment)
        .values({
          companyId: ctx.company.id,
          supplierInvoiceId: parsed.data.supplierInvoiceId,
          supplierPaymentId: createdPayment.id,
          amountApplied: parsed.data.amountApplied.toFixed(2),
        })
        .returning();

      await postSupplierPayment({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        supplierPaymentId: createdPayment.id,
        postedAt,
        reference: `Pago factura proveedor ${parsed.data.supplierInvoiceId}`,
        amount: parsed.data.amountApplied,
        dbClient: tx,
      });

      return appliedPayment;
    });

    return NextResponse.json(applied, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_NOT_FOUND") {
      return NextResponse.json({ message: "Factura de proveedor no encontrada." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_OVERPAYMENT") {
      return NextResponse.json({ message: "El importe supera el saldo pendiente de la factura de proveedor." }, { status: 400 });
    }
    throw error;
  }
}
