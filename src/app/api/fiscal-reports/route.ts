import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { spanishFiscalModelCodes } from "@/lib/fiscal-spain";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { createFiscalReport, listFiscalReports } from "@/server/fiscal/service";

const payloadSchema = z.object({
  code: z.enum(spanishFiscalModelCodes),
  period: z.string().trim().min(4).max(7),
  // "Presentado" no se elige al crear: se marca después con fecha y justificante (POST /[id]/file).
  status: z.enum(["DRAFT", "READY"]).default("DRAFT"),
});

export async function GET() {
  const ctx = await requireApiContext("fiscal.read");
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await listFiscalReports(ctx.company.id));
}

export async function POST(request: Request) {
  const ctx = await requireApiContext("fiscal.write");
  if (ctx instanceof NextResponse) return ctx;
  const rawPayload = await readJsonBody(request);
  if (!rawPayload) return invalidJsonResponse();

  const payload = payloadSchema.safeParse(rawPayload);
  if (!payload.success) return NextResponse.json({ message: "Revisa el modelo y el periodo (p. ej. 2026-Q1, 2026-04 o 2026). Para marcarlo como presentado, créalo primero y usa «Marcar como presentado»." }, { status: 400 });

  try {
    const created = await createFiscalReport(ctx.company.id, ctx.tenant.id, ctx.user.id, payload.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "fiscal-reports.save", "No se pudo guardar el modelo. Inténtalo de nuevo.");
  }
}

async function requireApiContext(permission: "fiscal.read" | "fiscal.write") {
  try {
    return await requireContext(permission);
  } catch (error) {
    return handleRouteError(error, "fiscal-reports.context");
  }
}
