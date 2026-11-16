import { NextResponse } from "next/server";

import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { requireContext } from "@/lib/current-context";
import { spanishFiscalModelCodes, type SpanishFiscalModelCode } from "@/lib/fiscal-spain";
import { handleRouteError } from "@/lib/http";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { calculateSpanishFiscalSummary } from "@/server/fiscal/spain";
import { calculateTaxSummary } from "@/server/fiscal/tax-summary";
import { parseTaxSummaryPeriod, recentTaxSummaryPeriods } from "@/server/fiscal/tax-summary-periods";

/**
 * Cálculo fiscal al vuelo, sin guardar nada:
 * - España (y Canarias/Ceuta/Melilla): `code` (303, 390, 347, 111, 115, 349, 130, 420, 425, 450) y
 *   `period` (2026-Q1, 2026-04 o 2026) → casillas, importe a ingresar y comprobaciones.
 * - Otros países: `period` (2026-Q1 o 2026-04) → impuesto repercutido − deducible del periodo.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("fiscal.read");
    const params = new URL(request.url).searchParams;
    const territory = await getCompanyTaxTerritory(ctx.company.id);
    const profile = getCountryFiscalProfile(territory);
    if (!profile.features.taxReports) {
      const period = parseTaxSummaryPeriod(params.get("period")) ?? recentTaxSummaryPeriods(new Date(), "quarterly", 1)[0];
      return NextResponse.json(await calculateTaxSummary(ctx.company.id, period, territory));
    }
    const code = params.get("code") ?? "";
    const period = params.get("period") ?? "";
    if (!(spanishFiscalModelCodes as readonly string[]).includes(code) || !period) {
      return NextResponse.json({ message: `Indica code (${spanishFiscalModelCodes.join(", ")}) y period (p. ej. 2026-Q1, 2026-04 o 2026).` }, { status: 400 });
    }
    const summary = await calculateSpanishFiscalSummary(ctx.company.id, code as SpanishFiscalModelCode, period);
    // Los documentos origen pueden ser cientos: se devuelven solo los recuentos.
    const { sourceDocuments, ...rest } = summary;
    return NextResponse.json({ ...rest, sourceDocumentCounts: { salesInvoices: sourceDocuments.salesInvoices.length, supplierInvoices: sourceDocuments.supplierInvoices.length } });
  } catch (error) {
    return handleRouteError(error, "fiscal.summary");
  }
}
