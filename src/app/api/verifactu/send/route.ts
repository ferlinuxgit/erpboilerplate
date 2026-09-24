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
    const summaries = await processPendingVerifactuRecords({ transport, companyId: ctx.company.id });
    return NextResponse.json({ summaries });
  } catch (error) {
    return handleRouteError(error, "verifactu.send", "No se pudo enviar a la AEAT. Se reintentará automáticamente.");
  }
}
