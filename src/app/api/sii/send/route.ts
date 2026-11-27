import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { processPendingSiiRecords } from "@/server/sii/sender";
import { refreshSiiOutbox } from "@/server/sii/service";
import { getConfiguredSiiTransport } from "@/server/sii/transport";

/** "Enviar ahora": revisa las facturas y envía a la AEAT lo pendiente de la empresa activa. */
export async function POST() {
  try {
    const ctx = await requireContext("fiscal.write");
    assertCountryFeature(ctx.company.countryCode, "taxReports");
    const detection = await refreshSiiOutbox(ctx.company.id);
    const { transport, reason } = getConfiguredSiiTransport();
    if (!transport) {
      return NextResponse.json(
        { message: `El envío a la AEAT no está configurado: ${reason} Los registros quedan en la bandeja y se enviarán cuando se configure.`, detection },
        { status: 409 },
      );
    }
    const summaries = await processPendingSiiRecords({ transport, companyId: ctx.company.id });
    const blocked = summaries.find((summary) => summary.sent === 0 && summary.error);
    const message = blocked?.error
      ?? (summaries.length === 0 ? "No hay registros que se puedan enviar ahora mismo: los pendientes están bloqueados, en espera de reintento o son de otro entorno." : null);
    return NextResponse.json({ summaries, detection, message });
  } catch (error) {
    return handleRouteError(error, "sii.send", "No se pudo enviar al SII. Se reintentará automáticamente.");
  }
}
