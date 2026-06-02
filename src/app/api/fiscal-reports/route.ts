import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { spanishFiscalModelCodes } from "@/lib/fiscal-spain";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { createFiscalReport, listFiscalReports } from "@/server/fiscal/service";

const payloadSchema = z.object({
  code: z.enum(spanishFiscalModelCodes),
  period: z.string().trim().min(4).max(7),
  status: z.enum(["DRAFT", "READY", "FILED"]),
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
  if (!payload.success) return NextResponse.json({ message: "Datos invalidos." }, { status: 400 });

  try {
    const created = await createFiscalReport(ctx.company.id, ctx.tenant.id, ctx.user.id, payload.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Datos invalidos.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

async function requireApiContext(permission: "fiscal.read" | "fiscal.write") {
  try {
    return await requireContext(permission);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No autorizado.";
    return NextResponse.json({ message }, { status: message.includes("permisos") ? 403 : 401 });
  }
}
