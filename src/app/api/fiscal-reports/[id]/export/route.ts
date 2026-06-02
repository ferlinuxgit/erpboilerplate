import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { isSpanishFiscalModelCode } from "@/lib/fiscal-spain";
import { getFiscalReport } from "@/server/fiscal/service";
import { calculateSpanishFiscalSummary } from "@/server/fiscal/spain";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext("fiscal.read");
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const report = await getFiscalReport(ctx.company.id, id);
  if (!report) return NextResponse.json({ message: "Reporte no encontrado." }, { status: 404 });
  if (!isSpanishFiscalModelCode(report.code)) return NextResponse.json({ message: "Modelo fiscal no soportado." }, { status: 400 });

  const summary = await calculateSpanishFiscalSummary(ctx.company.id, report.code, report.period);

  return NextResponse.json(
    {
      kind: "spanish-fiscal-working-paper",
      company: { id: ctx.company.id, name: ctx.company.name },
      report: {
        id: report.id,
        code: report.code,
        period: report.period,
        status: report.status,
        filedAt: report.filedAt,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
      },
      summary,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="modelo-${report.code}-${report.period}.json"`,
      },
    },
  );
}

async function requireApiContext(permission: "fiscal.read") {
  try {
    return await requireContext(permission);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No autorizado.";
    return NextResponse.json({ message }, { status: message.includes("permisos") ? 403 : 401 });
  }
}
