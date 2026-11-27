import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { buildXlsx } from "@/lib/xlsx-lite";
import { assertCorporateTaxCompany, getCorporateTaxStatements, getCorporateTaxYear } from "@/server/corporate-tax/service";
import { summaryWorkbookRows } from "@/server/corporate-tax/summary";

/**
 * Hoja de cálculo con lo que hay que trasladar a Sociedades WEB: la liquidación del ejercicio y el
 * balance y la cuenta de pérdidas y ganancias en el modelo abreviado. No es un fichero de
 * presentación: los importes se copian a mano en la sede de la AEAT.
 */
export async function GET(_: Request, { params }: { params: Promise<{ fiscalYearId: string }> }) {
  try {
    const { ctx } = await requirePermission("fiscal.read");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId } = await params;
    const [view, statements] = await Promise.all([getCorporateTaxYear(ctx.company.id, fiscalYearId), getCorporateTaxStatements(ctx.company.id, fiscalYearId)]);
    const file = buildXlsx(summaryWorkbookRows(view, statements), `Sociedades ${view.year.code}`.replace(/[\\/?*:[\]]/g, "-").slice(0, 31));
    return new NextResponse(file.slice().buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="impuesto-sociedades-${view.year.code.replace(/[^\w-]/g, "-")}.xlsx"`,
      },
    });
  } catch (error) {
    return handleRouteError(error, "corporate-tax.return.export", "No se pudo generar el resumen del Impuesto sobre Sociedades.");
  }
}
