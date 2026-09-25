import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { discardExpenseOcrJob, getExpenseOcrJob, processExpenseOcrJob, retryExpenseOcrJob } from "@/server/ocr/expense-ocr";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.read") && !can(ctx.membership.role, "purchase.read")) return NextResponse.json({ message: "Sin permisos para ver la bandeja de facturas." }, { status: 403 });
  const { id } = await params;
  const job = await getExpenseOcrJob(ctx.company.id, id);
  if (!job) return NextResponse.json({ message: "Documento no encontrado." }, { status: 404 });
  return NextResponse.json(job);
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write") && !can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos para volver a leer documentos." }, { status: 403 });
  const { id } = await params;
  const existing = await getExpenseOcrJob(ctx.company.id, id);
  if (!existing) return NextResponse.json({ message: "Documento no encontrado." }, { status: 404 });
  if (existing.status === "DONE") return NextResponse.json({ id, status: "DONE" });
  if (existing.status === "FAILED") await retryExpenseOcrJob(ctx.company.id, id);
  void processExpenseOcrJob(id);
  return NextResponse.json({ id, status: "PENDING" }, { status: 202 });
}

/** Descarta un documento de la bandeja pendiente (solo si todavía no es una factura). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write") && !can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos para descartar documentos." }, { status: 403 });
  const { id } = await params;
  try {
    const deleted = await discardExpenseOcrJob(ctx.company.id, id);
    if (!deleted) return NextResponse.json({ message: "Documento no encontrado." }, { status: 404 });
    await recordAudit({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      action: "expense.ocr.discard",
      entityName: "expenseOcrJob",
      entityId: id,
      payload: { fileName: deleted.fileName },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo descartar el documento.";
    return NextResponse.json({ message }, { status: 409 });
  }
}
