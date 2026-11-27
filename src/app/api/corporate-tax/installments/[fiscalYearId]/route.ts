import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { assertCorporateTaxCompany, getInstallments } from "@/server/corporate-tax/service";

/**
 * Pagos fraccionados del Impuesto sobre Sociedades (modelo 202) del ejercicio: los tres periodos
 * (1P abril, 2P octubre, 3P diciembre) con el cálculo de las dos modalidades (art. 40.2 y 40.3 de
 * la Ley 27/2014), lo ya ingresado y el pago contabilizado. Importes en céntimos.
 */
export async function GET(_: Request, { params }: { params: Promise<{ fiscalYearId: string }> }) {
  try {
    const { ctx } = await requirePermission("fiscal.read");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId } = await params;
    return NextResponse.json(await getInstallments(ctx.company.id, fiscalYearId));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.installments.get", "No se pudieron calcular los pagos fraccionados.");
  }
}
