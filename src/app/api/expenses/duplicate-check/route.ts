import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getExpenseOcrJob } from "@/server/ocr/expense-ocr";
import { assessExpenseDuplicate } from "@/server/supplier-invoices/service";

const payloadSchema = z.object({
  supplierPartnerId: z.string().trim().optional(),
  supplierTaxId: z.string().trim().optional(),
  supplierName: z.string().trim().optional(),
  supplierCountryCode: z.string().trim().length(2).optional(),
  supplierDocumentNumber: z.string().trim().optional(),
  issueDate: z.string().datetime().optional(),
  totalAmount: z.number().nonnegative().optional(),
  ocrJobId: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos para comprobar gastos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos de comprobación inválidos." }, { status: 400 });
  const job = parsed.data.ocrJobId ? await getExpenseOcrJob(ctx.company.id, parsed.data.ocrJobId) : null;
  const result = await assessExpenseDuplicate({
    companyId: ctx.company.id,
    supplierPartnerId: parsed.data.supplierPartnerId,
    supplierTaxId: parsed.data.supplierTaxId,
    supplierName: parsed.data.supplierName,
    supplierCountryCode: parsed.data.supplierCountryCode,
    supplierDocumentNumber: parsed.data.supplierDocumentNumber,
    issueDate: parsed.data.issueDate ? new Date(parsed.data.issueDate) : undefined,
    totalAmount: parsed.data.totalAmount,
    documentSha256: job?.documentSha256 ?? undefined,
  });
  return NextResponse.json(result);
}
