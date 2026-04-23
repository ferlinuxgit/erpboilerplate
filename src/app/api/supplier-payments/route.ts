import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { postSupplierPayment } from "@/server/accounting/auto-post";

const payloadSchema = z.object({
  supplierInvoiceId: z.string().trim().min(1),
  amountApplied: z.number().positive(),
  postedAt: z.string().trim().min(1),
});

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

  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [ownedInvoice] = await db
    .select({ id: supplierInvoice.id })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.id, parsed.data.supplierInvoiceId), eq(supplierInvoice.companyId, ctx.company.id)))
    .limit(1);
  if (!ownedInvoice) return NextResponse.json({ message: "Factura de proveedor no encontrada." }, { status: 404 });

  const [createdPayment] = await db.insert(supplierPayment).values({
    companyId: ctx.company.id,
    supplierInvoiceId: parsed.data.supplierInvoiceId,
    amount: parsed.data.amountApplied.toFixed(2),
    postedAt: new Date(parsed.data.postedAt),
  }).returning();

  const [applied] = await db.insert(supplierInvoicePayment).values({
    companyId: ctx.company.id,
    supplierInvoiceId: parsed.data.supplierInvoiceId,
    supplierPaymentId: createdPayment.id,
    amountApplied: parsed.data.amountApplied.toFixed(2),
  }).returning();

  await postSupplierPayment({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    supplierPaymentId: createdPayment.id,
    postedAt: new Date(parsed.data.postedAt),
    reference: `Pago factura proveedor ${parsed.data.supplierInvoiceId}`,
    amount: parsed.data.amountApplied,
  });

  return NextResponse.json(applied, { status: 201 });
}
