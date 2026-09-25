import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createExpenseOcrBatch, listExpenseInbox, listExpenseOcrBatches } from "@/server/ocr/expense-ocr";
import { withDuplicateAssessment } from "@/server/ocr/inbox";

const payloadSchema = z.object({ expectedFiles: z.number().int().min(1).max(50) });

/** Bandeja pendiente: lotes recientes y documentos todavía sin registrar de la empresa activa. */
export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.read") && !can(ctx.membership.role, "purchase.read")) return NextResponse.json({ message: "Sin permisos para ver la bandeja de facturas." }, { status: 403 });
  const [batches, inbox] = await Promise.all([listExpenseOcrBatches(ctx.company.id), listExpenseInbox(ctx.company.id)]);
  const jobs = await withDuplicateAssessment(ctx.company.id, inbox);
  return NextResponse.json({ batches, jobs });
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write") && !can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos para crear lotes de facturas de proveedor." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "El lote debe contener entre 1 y 50 archivos." }, { status: 400 });
  const batch = await createExpenseOcrBatch({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    expectedFiles: parsed.data.expectedFiles,
  });
  return NextResponse.json(batch, { status: 201 });
}
