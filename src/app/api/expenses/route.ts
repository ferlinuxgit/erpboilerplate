import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createExpenseInvoice, listExpenseInvoices } from "@/server/supplier-invoices/service";

const payloadSchema = z.object({
  supplierPartnerId: z.string().trim().optional().or(z.literal("")),
  supplierName: z.string().trim().optional().or(z.literal("")),
  supplierTaxId: z.string().trim().optional().or(z.literal("")),
  number: z.string().trim().optional().or(z.literal("")),
  supplierDocumentNumber: z.string().trim().optional().or(z.literal("")),
  issueDate: z.string().datetime(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().trim().optional().or(z.literal("")),
  attachments: z
    .array(
      z.object({
        fileName: z.string().trim().min(1),
        fileUrl: z.string().trim().url(),
        storageKey: z.string().trim().optional().or(z.literal("")),
        contentType: z.string().trim().optional().or(z.literal("")),
        sizeBytes: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
  lines: z
    .array(
      z.object({
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
  if (!can(ctx.membership.role, "expense.read")) return NextResponse.json({ message: "Sin permisos para ver gastos." }, { status: 403 });
  return NextResponse.json(await listExpenseInvoices(ctx.company.id));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos para crear gastos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });
  if (!parsed.data.supplierPartnerId && !parsed.data.supplierName && !parsed.data.supplierTaxId) {
    return NextResponse.json({ message: "Indica proveedor existente, nombre de proveedor o CIF/NIF." }, { status: 400 });
  }

  try {
    const created = await createExpenseInvoice({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
      actorUserId: session.user.id,
      supplierPartnerId: parsed.data.supplierPartnerId || undefined,
      supplierName: parsed.data.supplierName || undefined,
      supplierTaxId: parsed.data.supplierTaxId || undefined,
      number: parsed.data.number || undefined,
      supplierDocumentNumber: parsed.data.supplierDocumentNumber || undefined,
      issueDate: new Date(parsed.data.issueDate),
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      notes: parsed.data.notes || undefined,
      attachments: parsed.data.attachments?.map((attachment) => ({
        fileName: attachment.fileName,
        fileUrl: attachment.fileUrl,
        storageKey: attachment.storageKey || undefined,
        contentType: attachment.contentType || undefined,
        sizeBytes: attachment.sizeBytes,
      })),
      lines: parsed.data.lines.map((line) => ({
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
    const message = error instanceof Error ? error.message : "No se pudo crear el gasto.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
