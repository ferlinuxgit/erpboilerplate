import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getExpenseOcrBatch } from "@/server/ocr/expense-ocr";
import { withDuplicateAssessment } from "@/server/ocr/inbox";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.read") && !can(ctx.membership.role, "purchase.read")) return NextResponse.json({ message: "Sin permisos para ver lotes de facturas de proveedor." }, { status: 403 });
  const { id } = await params;
  const batch = await getExpenseOcrBatch(ctx.company.id, id);
  if (!batch) return NextResponse.json({ message: "Lote no encontrado." }, { status: 404 });
  const jobs = await withDuplicateAssessment(ctx.company.id, batch.jobs);
  return NextResponse.json({ ...batch, jobs });
}
