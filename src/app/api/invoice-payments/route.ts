import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { invoice, invoicePayment, payment } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { postCustomerPayment } from "@/server/accounting/auto-post";

const payloadSchema = z.object({
  invoiceId: z.string().trim().min(1),
  amountApplied: z.number().positive(),
  postedAt: z.string().trim().min(1),
});

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

  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [ownedInvoice] = await db
    .select({ id: invoice.id, totalAmount: invoice.totalAmount })
    .from(invoice)
    .where(and(eq(invoice.id, parsed.data.invoiceId), eq(invoice.companyId, ctx.company.id)))
    .limit(1);
  if (!ownedInvoice) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });

  const [createdPayment] = await db.insert(payment).values({
    companyId: ctx.company.id,
    invoiceId: parsed.data.invoiceId,
    amount: parsed.data.amountApplied.toFixed(2),
    postedAt: new Date(parsed.data.postedAt),
  }).returning();

  const [applied] = await db.insert(invoicePayment).values({
    companyId: ctx.company.id,
    invoiceId: parsed.data.invoiceId,
    paymentId: createdPayment.id,
    amountApplied: parsed.data.amountApplied.toFixed(2),
  }).returning();

  const appliedPayments = await db
    .select({ amountApplied: invoicePayment.amountApplied })
    .from(invoicePayment)
    .where(and(eq(invoicePayment.invoiceId, parsed.data.invoiceId), eq(invoicePayment.companyId, ctx.company.id)));
  const paidAmount = appliedPayments.reduce((total, payment) => total + Number(payment.amountApplied), 0);
  const invoiceTotal = Number(ownedInvoice.totalAmount);
  await db
    .update(invoice)
    .set({ paymentStatus: paidAmount >= invoiceTotal ? "PAID" : "PARTIAL", updatedAt: new Date() })
    .where(and(eq(invoice.id, parsed.data.invoiceId), eq(invoice.companyId, ctx.company.id)));

  await postCustomerPayment({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    paymentId: createdPayment.id,
    postedAt: new Date(parsed.data.postedAt),
    reference: `Cobro factura ${parsed.data.invoiceId}`,
    amount: parsed.data.amountApplied,
  });

  return NextResponse.json(applied, { status: 201 });
}
