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
  supplierEmail: z.string().trim().email().optional().or(z.literal("")),
  supplierPhone: z.string().trim().optional().or(z.literal("")),
  supplierAddress: z.string().trim().optional().or(z.literal("")),
  supplierAddressLine2: z.string().trim().optional().or(z.literal("")),
  supplierPostalCode: z.string().trim().optional().or(z.literal("")),
  supplierCity: z.string().trim().optional().or(z.literal("")),
  supplierProvince: z.string().trim().optional().or(z.literal("")),
  supplierCountryCode: z.string().trim().length(2).optional().or(z.literal("")),
  purchaseOrderId: z.string().trim().optional().or(z.literal("")),
  goodsReceiptId: z.string().trim().optional().or(z.literal("")),
  number: z.string().trim().optional().or(z.literal("")),
  supplierDocumentNumber: z.string().trim().optional().or(z.literal("")),
  issueDate: z.string().datetime(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().trim().optional().or(z.literal("")),
  ocrJobId: z.string().trim().optional().or(z.literal("")),
  currencyCode: z.string().trim().length(3).optional(),
  idempotencyKey: z.string().trim().max(160).optional().or(z.literal("")),
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

function expenseCreationError(error: unknown) {
  const record = error && typeof error === "object" ? error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } : null;
  const code = record?.code ?? record?.cause?.code;
  const constraint = record?.constraint ?? record?.cause?.constraint ?? "";
  if (code === "23505" && constraint.includes("document_sha")) return "Factura duplicada: este archivo ya fue contabilizado.";
  if (code === "23505" && constraint.includes("supplier_document_canonical")) return "Factura duplicada: ya existe ese número de factura para el proveedor.";
  if (code === "23505" && constraint.includes("idempotency")) return "La solicitud ya fue procesada; actualiza la lista de facturas.";
  return error instanceof Error ? error.message : "No se pudo crear la factura de proveedor.";
}

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.read") && !can(ctx.membership.role, "purchase.read")) return NextResponse.json({ message: "Sin permisos para ver facturas de proveedor." }, { status: 403 });
  return NextResponse.json(await listExpenseInvoices(ctx.company.id));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write") && !can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos para crear facturas de proveedor." }, { status: 403 });

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
      supplierEmail: parsed.data.supplierEmail || undefined,
      supplierPhone: parsed.data.supplierPhone || undefined,
      supplierAddress: parsed.data.supplierAddress || undefined,
      supplierAddressLine2: parsed.data.supplierAddressLine2 || undefined,
      supplierPostalCode: parsed.data.supplierPostalCode || undefined,
      supplierCity: parsed.data.supplierCity || undefined,
      supplierProvince: parsed.data.supplierProvince || undefined,
      supplierCountryCode: parsed.data.supplierCountryCode || undefined,
      purchaseOrderId: parsed.data.purchaseOrderId || undefined,
      goodsReceiptId: parsed.data.goodsReceiptId || undefined,
      number: parsed.data.number || undefined,
      supplierDocumentNumber: parsed.data.supplierDocumentNumber || undefined,
      issueDate: new Date(parsed.data.issueDate),
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      notes: parsed.data.notes || undefined,
      ocrJobId: parsed.data.ocrJobId || undefined,
      currencyCode: parsed.data.currencyCode,
      idempotencyKey: parsed.data.idempotencyKey || undefined,
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
    const message = expenseCreationError(error);
    const status = message.toLocaleLowerCase().includes("duplicad") || message.includes("ya fue procesada") ? 409 : 400;
    return NextResponse.json({ message }, { status });
  }
}
