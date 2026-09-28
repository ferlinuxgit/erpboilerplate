import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { buildChartCsv, buildChartXlsx } from "@/server/accounting/chart-export";
import { listChartForExport } from "@/server/accounting/chart-tree";
import { parseChartRequest } from "@/server/accounting/chart-tree-request";

/** Plan contable hasta el nivel elegido (`?level=`), con el periodo y los filtros de la pantalla. */
export async function GET(request: Request) {
  try {
    const { ctx } = await requirePermission("accounting.read");
    const params = new URL(request.url).searchParams;
    const format = params.get("format") === "csv" ? "csv" : "xlsx";
    const { period, filters, level } = await parseChartRequest(ctx.company.id, ctx.fiscalYear.id, params);
    const tree = await listChartForExport(ctx.company.id, { ...period.range, level, filters });
    const fileName = `plan-contable-${period.keys.from}-${period.keys.to}-nivel-${level}`;
    if (format === "csv") {
      return new NextResponse(buildChartCsv(tree.nodes), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}.csv"` },
      });
    }
    const file = await buildChartXlsx(tree.nodes, { title: `Plan contable de ${ctx.company.name}`, period: `Del ${period.keys.from} al ${period.keys.to}` });
    return new NextResponse(file, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}.xlsx"`,
      },
    });
  } catch (error) {
    return handleRouteError(error, "accounts.export", "No se pudo exportar el plan contable.");
  }
}
