import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { isSpanishFiscalModelCode } from "@/lib/fiscal-spain";
import { getFiscalReport } from "@/server/fiscal/service";
import { calculateSpanishFiscalSummary } from "@/server/fiscal/spain";
import { renderFiscalReportPdf } from "@/server/pdf/render";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext("fiscal.read");
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const report = await getFiscalReport(ctx.company.id, id);
  if (!report) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
  if (!isSpanishFiscalModelCode(report.code)) return NextResponse.json({ message: "Modelo fiscal no soportado." }, { status: 400 });

  const summary = await calculateSpanishFiscalSummary(ctx.company.id, report.code, report.period);
  const pdf = await renderFiscalReportPdf({ companyName: ctx.company.name, summary });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Disposition": `attachment; filename="modelo-${report.code}-${report.period}.pdf"`,
      "Content-Type": "application/pdf",
    },
  });
}

async function requireApiContext(permission: "fiscal.read") {
  try {
    return await requireContext(permission);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No autorizado.";
    return NextResponse.json({ message }, { status: message.includes("permisos") ? 403 : 401 });
  }
}
