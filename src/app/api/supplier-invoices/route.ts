import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { supplierInvoice } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createPurchaseSupplierInvoice } from "@/server/supplier-invoices/service";

const payloadSchema = z.object({
  supplierPartnerId: z.string().trim().min(1),
  purchaseOrderId: z.string().trim().min(1),
  goodsReceiptId: z.string().trim().min(1),
  number: z.string().trim().optional().or(z.literal("")),
  supplierDocumentNumber: z.string().trim().optional().or(z.literal("")),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().trim().optional().or(z.literal("")),
  lines: z
    .array(
      z.object({
        itemId: z.string().trim().optional().or(z.literal("")),
        expenseAccountId: z.string().trim().optional().or(z.literal("")),
        description: z.string().trim().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        taxRate: z.number().min(0).max(100).default(21),
        taxDeductiblePct: z.number().min(0).max(100).default(100),
        retentionRate: z.number().min(0).max(100).default(0),
      }),
    )
    .min(1),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(supplierInvoice).where(eq(supplierInvoice.companyId, ctx.company.id)));
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

  try {
    const created = await createPurchaseSupplierInvoice({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
      actorUserId: session.user.id,
      supplierPartnerId: parsed.data.supplierPartnerId,
      purchaseOrderId: parsed.data.purchaseOrderId,
      goodsReceiptId: parsed.data.goodsReceiptId,
      number: parsed.data.number || undefined,
      supplierDocumentNumber: parsed.data.supplierDocumentNumber || undefined,
      issueDate: parsed.data.issueDate ? new Date(parsed.data.issueDate) : undefined,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      notes: parsed.data.notes || undefined,
      lines: parsed.data.lines.map((line) => ({
        itemId: line.itemId || undefined,
        expenseAccountId: line.expenseAccountId || undefined,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        taxDeductiblePct: line.taxDeductiblePct,
        retentionRate: line.retentionRate,
      })),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la factura proveedor.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
