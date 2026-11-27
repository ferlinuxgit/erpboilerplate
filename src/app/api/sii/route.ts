import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { getSiiOverview } from "@/server/sii/service";

/** Estado del SII de la empresa activa: pendientes (con su plazo), rechazados, aceptados y configuración. */
export async function GET() {
  try {
    const ctx = await requireContext("fiscal.read");
    assertCountryFeature(ctx.company.countryCode, "taxReports");
    return NextResponse.json(await getSiiOverview(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "sii.overview", "No se pudo consultar el estado del SII.");
  }
}
