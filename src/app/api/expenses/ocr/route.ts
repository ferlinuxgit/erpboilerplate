import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createExpenseOcrJob, listRecentExpenseOcrJobs, processExpenseOcrJob } from "@/server/ocr/expense-ocr";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.read")) return NextResponse.json({ message: "Sin permisos para ver OCR de gastos." }, { status: 403 });
  return NextResponse.json(await listRecentExpenseOcrJobs(ctx.company.id));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos para procesar OCR de gastos." }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Adjunta un PDF o imagen." }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ message: "El archivo OCR no puede superar 12 MB." }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const job = await createExpenseOcrJob({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      buffer,
    });
    void processExpenseOcrJob(job.id);
    return NextResponse.json({ id: job.id, status: job.status, fileName: job.fileName }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el job OCR.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
