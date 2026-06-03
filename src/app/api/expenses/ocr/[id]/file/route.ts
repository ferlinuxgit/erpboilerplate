import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getExpenseOcrJob } from "@/server/ocr/expense-ocr";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.read")) return NextResponse.json({ message: "Sin permisos para ver adjuntos OCR." }, { status: 403 });
  const { id } = await params;
  const job = await getExpenseOcrJob(ctx.company.id, id);
  if (!job) return NextResponse.json({ message: "Archivo OCR no encontrado." }, { status: 404 });
  const data = await readFile(job.filePath);
  return new Response(data, {
    headers: {
      "Content-Type": job.contentType,
      "Content-Disposition": `inline; filename="${job.fileName.replaceAll("\"", "")}"`,
    },
  });
}
