import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { spanishFiscalModelCodes } from "@/lib/fiscal-spain";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { deleteFiscalReport, getFiscalReport, updateFiscalReport } from "@/server/fiscal/service";

const payloadSchema = z.object({
  code: z.enum(spanishFiscalModelCodes),
  period: z.string().trim().min(4).max(7),
  status: z.enum(["DRAFT", "READY", "FILED"]),
  reopenReason: z.string().trim().min(3).max(500).optional(),
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
  if (!payload.success) return NextResponse.json({ message: "Revisa el modelo, el periodo (p. ej. 2026-Q1, 2026-04 o 2026) y el estado." }, { status: 400 });
  const { id } = await params;
  try {
    const updated = await updateFiscalReport(ctx.company.id, ctx.tenant.id, ctx.user.id, id, payload.data);
    if (!updated) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "fiscal-reports.save", "No se pudo guardar el modelo. Inténtalo de nuevo.");
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext("fiscal.write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  try {
    const deleted = await deleteFiscalReport(ctx.company.id, ctx.tenant.id, ctx.user.id, id);
    if (!deleted) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "fiscal-reports.delete", "No se pudo eliminar el modelo. Inténtalo de nuevo.");
  }
}

async function requireApiContext(permission: "fiscal.read" | "fiscal.write") {
  try {
    return await requireContext(permission);
  } catch (error) {
    return handleRouteError(error, "fiscal-reports.context");
  }
}
