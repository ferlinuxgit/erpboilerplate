import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { resendSiiRecord } from "@/server/sii/service";

const payloadSchema = z.object({ recordId: z.string().trim().min(1).max(80) });

/** Vuelve a poner en la bandeja un registro rechazado, aceptado con errores o sin confirmar. */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("fiscal.write");
    assertCountryFeature(ctx.company.countryCode, "taxReports");
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Indica el registro que quieres reenviar." }, { status: 400 });
    return NextResponse.json(await resendSiiRecord(ctx.company.id, parsed.data.recordId));
  } catch (error) {
    return handleRouteError(error, "sii.resend", "No se pudo reenviar el registro.");
  }
}
