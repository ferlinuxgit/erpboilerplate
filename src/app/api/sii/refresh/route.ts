import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { refreshSiiOutbox } from "@/server/sii/service";

/** "Revisar ahora": busca facturas expedidas y recibidas sin suministrar, modificadas o anuladas. */
export async function POST() {
  try {
    const ctx = await requireContext("fiscal.write");
    assertCountryFeature(ctx.company.countryCode, "taxReports");
    return NextResponse.json(await refreshSiiOutbox(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "sii.refresh", "No se pudieron revisar las facturas.");
  }
}
