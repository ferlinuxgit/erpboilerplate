import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { exportSiiRecords } from "@/server/sii/service";

/** Descarga (CSV) de todo lo comunicado al SII. */
export async function GET() {
  try {
    const ctx = await requireContext("fiscal.read");
    assertCountryFeature(ctx.company.countryCode, "taxReports");
    const file = await exportSiiRecords(ctx.company.id);
    return new NextResponse(file.content, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "sii.export", "No se pudieron exportar los registros.");
  }
}
