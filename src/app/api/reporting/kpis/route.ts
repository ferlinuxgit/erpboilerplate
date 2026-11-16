import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import type { ReportingPeriod } from "@/lib/reporting-period";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { loadReportingKpis } from "@/server/reporting/service";

/**
 * Indicadores del periodo (los de la pantalla Informes): ventas, gastos, cobros, márgenes,
 * comparados con el periodo anterior. Consulta: `period` = month (por defecto), quarter o year.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("reporting.read");
    const requested = new URL(request.url).searchParams.get("period");
    const period: ReportingPeriod = requested === "quarter" || requested === "year" ? requested : "month";
    return NextResponse.json(await loadReportingKpis(ctx.company.id, period, { countryCode: await getCompanyTaxTerritory(ctx.company.id) }));
  } catch (error) {
    return handleRouteError(error, "reporting.kpis");
  }
}
