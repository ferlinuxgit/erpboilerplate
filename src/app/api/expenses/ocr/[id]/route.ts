import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getExpenseOcrJob, processExpenseOcrJob } from "@/server/ocr/expense-ocr";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.read")) return NextResponse.json({ message: "Sin permisos para ver OCR de gastos." }, { status: 403 });
  const { id } = await params;
  const job = await getExpenseOcrJob(ctx.company.id, id);
  if (!job) return NextResponse.json({ message: "Job OCR no encontrado." }, { status: 404 });
  return NextResponse.json(job);
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos para reintentar OCR de gastos." }, { status: 403 });
  const { id } = await params;
  const existing = await getExpenseOcrJob(ctx.company.id, id);
  if (!existing) return NextResponse.json({ message: "Job OCR no encontrado." }, { status: 404 });
  void processExpenseOcrJob(id);
  return NextResponse.json({ id, status: "PROCESSING" }, { status: 202 });
}
