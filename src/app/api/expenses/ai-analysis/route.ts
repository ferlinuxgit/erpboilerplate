import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { analyzeExpenseInvoiceWithOpenAI } from "@/server/ai/expense-invoice-analysis";

const supportedContentTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "expense.write")) return NextResponse.json({ message: "Sin permisos para analizar gastos." }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Adjunta un PDF o imagen." }, { status: 400 });
  if (!supportedContentTypes.has(file.type)) return NextResponse.json({ message: "Formato no soportado. Usa PDF, PNG, JPG o WEBP." }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ message: "El archivo no puede superar 12 MB." }, { status: 400 });

  try {
    const result = await analyzeExpenseInvoiceWithOpenAI({
      fileName: file.name,
      contentType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ fileName: file.name, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo analizar la factura con OpenAI.";
    const status = message.includes("OPENAI_API_KEY") ? 503 : 400;
    return NextResponse.json({ message }, { status });
  }
}
