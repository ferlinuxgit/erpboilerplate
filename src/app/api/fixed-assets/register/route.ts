import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { buildXlsx, type XlsxCell } from "@/lib/xlsx-lite";
import { formatIsoDate } from "@/server/fixed-assets/schedule";
import { getAssetRegister } from "@/server/fixed-assets/service";

/**
 * Libro registro de bienes de inversión del ejercicio (`?fiscalYearId=`, por defecto el activo).
 * Con `?format=xlsx` devuelve la hoja de cálculo; sin él, los datos en JSON.
 */
export async function GET(request: Request) {
  try {
    const { ctx } = await requirePermission("accounting.read");
    const params = new URL(request.url).searchParams;
    const register = await getAssetRegister(ctx.company.id, params.get("fiscalYearId") ?? ctx.fiscalYear.id);
    if (!register) return NextResponse.json({ message: "Ejercicio no encontrado." }, { status: 404 });
    if (params.get("format") !== "xlsx") return NextResponse.json(register);

    const rows: XlsxCell[][] = [
      ["Código", "Descripción", "Cuenta", "Fecha de adquisición", "Puesta en funcionamiento", "Valor de adquisición", "% anual", "Amortización del ejercicio", "Amortización acumulada", "Valor neto contable", "Fecha de baja", "Importe de la venta"],
      ...register.rows.map((row): XlsxCell[] => [
        row.code,
        row.description,
        row.assetAccountCode,
        formatIsoDate(row.acquisitionDate),
        formatIsoDate(row.inServiceDate),
        row.costCents / 100,
        row.annualPct === null ? null : Math.round(row.annualPct * 100) / 100,
        row.yearDepreciationCents / 100,
        row.accumulatedCents / 100,
        row.netBookValueCents / 100,
        formatIsoDate(row.disposalDate),
        row.disposalProceedsCents === null ? null : row.disposalProceedsCents / 100,
      ]),
    ];
    const file = buildXlsx(rows, `Bienes de inversión ${register.year.code}`);
    return new NextResponse(file.slice().buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="libro-bienes-inversion-${register.year.code.replace(/[^\w-]/g, "-")}.xlsx"`,
      },
    });
  } catch (error) {
    return handleRouteError(error, "fixed-assets.register", "No se pudo generar el libro de bienes de inversión.");
  }
}
