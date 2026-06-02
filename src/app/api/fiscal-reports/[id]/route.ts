import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { spanishFiscalModelCodes } from "@/lib/fiscal-spain";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { deleteFiscalReport, getFiscalReport, updateFiscalReport } from "@/server/fiscal/service";

const payloadSchema = z.object({
  code: z.enum(spanishFiscalModelCodes),
  period: z.string().trim().min(4).max(7),
  status: z.enum(["DRAFT", "READY", "FILED"]),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext("fiscal.read");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const report = await getFiscalReport(ctx.company.id, id);
  if (!report) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
  return NextResponse.json(report);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext("fiscal.write");
  if (ctx instanceof NextResponse) return ctx;
  const rawPayload = await readJsonBody(request);
  if (!rawPayload) return invalidJsonResponse();

  const payload = payloadSchema.safeParse(rawPayload);
  if (!payload.success) return NextResponse.json({ message: "Datos invalidos." }, { status: 400 });
  const { id } = await params;
  try {
    const updated = await updateFiscalReport(ctx.company.id, ctx.tenant.id, ctx.user.id, id, payload.data);
    if (!updated) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Datos invalidos.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext("fiscal.write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const deleted = await deleteFiscalReport(ctx.company.id, ctx.tenant.id, ctx.user.id, id);
  if (!deleted) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

async function requireApiContext(permission: "fiscal.read" | "fiscal.write") {
  try {
    return await requireContext(permission);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No autorizado.";
    return NextResponse.json({ message }, { status: message.includes("permisos") ? 403 : 401 });
  }
}
