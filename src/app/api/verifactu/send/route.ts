import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { processPendingVerifactuRecords } from "@/server/verifactu/sender";
import { getConfiguredTransport } from "@/server/verifactu/transport";

/** "Enviar ahora": procesa los registros pendientes de la empresa activa si el envío está configurado. */
export async function POST() {
  try {
    const ctx = await requireContext("fiscal.write");
    const { transport, reason } = getConfiguredTransport();
    if (!transport) {
      return NextResponse.json(
        { message: `El envío a la AEAT no está configurado: ${reason} Los registros siguen guardados y se enviarán cuando se configure el certificado.` },
        { status: 409 },
      );
    }
    // Sin `pause`: si la AEAT pidió esperar, no se envía (lo dice el mensaje); y un lote que falla
    // entero queda pendiente para que el worker aísle el registro culpable respetando la espera.
    const summaries = await processPendingVerifactuRecords({ transport, companyId: ctx.company.id });
    const throttled = summaries.find((summary) => summary.throttledSeconds);
    const blocked = summaries.find((summary) => summary.sent === 0 && summary.error);
    const message = throttled
      ? `La AEAT pide esperar entre envíos: faltan ${throttled.throttledSeconds} s para el siguiente. Los registros se enviarán solos en cuanto pase ese tiempo.`
      : blocked?.error ?? (summaries.length === 0 ? "No hay registros que se puedan enviar ahora mismo: los pendientes están en espera de reintento o son de otro entorno." : null);
    return NextResponse.json({ summaries, message });
  } catch (error) {
    return handleRouteError(error, "verifactu.send", "No se pudo enviar a la AEAT. Se reintentará automáticamente.");
  }
}
