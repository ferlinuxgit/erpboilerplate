import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { isSpanishFiscalModelCode } from "@/lib/fiscal-spain";
import { fiscalSummaryToCsv } from "@/server/fiscal/export";
import { getFiscalReport, resolveFiscalReportSummary } from "@/server/fiscal/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext("fiscal.read");
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const report = await getFiscalReport(ctx.company.id, id);
  if (!report) return NextResponse.json({ message: "Modelo no encontrado." }, { status: 404 });
  if (!isSpanishFiscalModelCode(report.code)) return NextResponse.json({ message: "Modelo fiscal no soportado." }, { status: 400 });

  // Un modelo presentado se exporta tal como se presentó (foto guardada), no recalculado.
  const resolved = await resolveFiscalReportSummary(ctx.company.id, report);
  if (!resolved) return NextResponse.json({ message: "Modelo fiscal no soportado." }, { status: 400 });
  const { summary } = resolved;

  // ?format=csv → hoja de cálculo con las mismas casillas/operadores que el PDF.
  if (new URL(request.url).searchParams.get("format") === "csv") {
    return new Response(fiscalSummaryToCsv(summary), {
      headers: {
        "Content-Disposition": `attachment; filename="modelo-${report.code}-${report.period}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }

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
        // "snapshot": importes tal como se presentaron; "live": calculados ahora.
        summarySource: resolved.source,
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
    return handleRouteError(error, "fiscal-reports.context");
  }
}
