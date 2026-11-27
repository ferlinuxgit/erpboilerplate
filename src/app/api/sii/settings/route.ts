import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { updateSiiSince } from "@/server/sii/service";

const payloadSchema = z.object({ since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Fecha desde la que se suministran las facturas al SII. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireContext("fiscal.write");
    assertCountryFeature(ctx.company.countryCode, "taxReports");
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Indica la fecha de inicio (AAAA-MM-DD)." }, { status: 400 });
    return NextResponse.json(await updateSiiSince(ctx.company.id, parsed.data.since));
  } catch (error) {
    return handleRouteError(error, "sii.settings", "No se pudo guardar la fecha de inicio.");
  }
}
