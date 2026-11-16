import { NextResponse } from "next/server";

import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { getCurrentFiscalObligations } from "@/server/fiscal/obligations";
import { listFiscalReportsWithSummary } from "@/server/fiscal/service";

/**
 * Qué tiene que presentar la empresa ahora y cuándo (modelos 303, 111, 130, 420…), con su
 * estado y el importe calculado si ya existe el borrador. Vacío en países sin modelos oficiales.
 */
export async function GET() {
  try {
    const ctx = await requireContext("fiscal.read");
    const territory = await getCompanyTaxTerritory(ctx.company.id);
    if (!getCountryFiscalProfile(territory).features.taxReports) return NextResponse.json({ territory, obligations: [] });
    const reports = await listFiscalReportsWithSummary(ctx.company.id);
    return NextResponse.json({ territory, obligations: await getCurrentFiscalObligations(ctx.company.id, reports) });
  } catch (error) {
    return handleRouteError(error, "fiscal.obligations");
  }
}
