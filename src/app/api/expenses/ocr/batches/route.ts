import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createExpenseOcrBatch } from "@/server/ocr/expense-ocr";

const payloadSchema = z.object({ expectedFiles: z.number().int().min(1).max(50) });

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
