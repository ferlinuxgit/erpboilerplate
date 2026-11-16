import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import type { FinancePeriod } from "@/server/reporting/dashboard-model";
import { loadDashboardFinance } from "@/server/reporting/dashboard";

/**
 * Panel financiero (el del inicio): ventas y gastos del periodo, impuesto estimado del trimestre,
 * pendiente de cobro y de pago, saldos bancarios, evolución mensual y próximos plazos fiscales.
 * Consulta: `period` = month (por defecto), quarter o year.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("reporting.read");
    const requested = new URL(request.url).searchParams.get("period");
    const period: FinancePeriod = requested === "quarter" || requested === "year" ? requested : "month";
    return NextResponse.json(await loadDashboardFinance(ctx.company.id, { period, countryCode: await getCompanyTaxTerritory(ctx.company.id) }));
  } catch (error) {
    return handleRouteError(error, "reporting.dashboard");
  }
}
