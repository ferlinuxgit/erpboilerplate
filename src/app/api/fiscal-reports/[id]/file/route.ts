import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { markFiscalReportFiled } from "@/server/fiscal/service";

const payloadSchema = z.object({
  filedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  receiptNumber: z.string().trim().min(1).max(60),
  nrc: z.string().trim().max(60).optional().nullable(),
});

/** Marca el modelo como presentado en la AEAT (fecha + justificante + NRC opcional). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof requireContext>>;
  try {
    ctx = await requireContext("fiscal.write");
  } catch (error) {
    return handleRouteError(error, "fiscal-reports.context");
  }
  const rawPayload = await readJsonBody(request);
  if (!rawPayload) return invalidJsonResponse();
  const payload = payloadSchema.safeParse(rawPayload);
  if (!payload.success) {
    return NextResponse.json({ message: "Indica la fecha de presentación y el número de justificante de la AEAT." }, { status: 400 });
  }
  const { id } = await params;
  try {
    const updated = await markFiscalReportFiled(ctx.company.id, ctx.tenant.id, ctx.user.id, id, {
      filedAt: new Date(`${payload.data.filedAt}T12:00:00.000Z`),
      receiptNumber: payload.data.receiptNumber,
      nrc: payload.data.nrc ?? null,
    });
    if (!updated) return NextResponse.json({ message: "Modelo no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "fiscal-reports.file", "No se pudo marcar el modelo como presentado. Inténtalo de nuevo.");
  }
}
