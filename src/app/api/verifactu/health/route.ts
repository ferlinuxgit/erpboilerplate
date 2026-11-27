import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { can } from "@/lib/rbac";
import { getVerifactuAlert } from "@/server/verifactu/alert";

/**
 * Aviso global de VERI*FACTU de la empresa activa: solo problemas graves (facturas sin enviar desde
 * hace más de una hora, rechazadas o certificado caducado). `alert: null` si todo va bien o si el
 * usuario no puede ver Fiscalidad. Consulta ligera; el navegador la guarda unos minutos.
 */
export async function GET() {
  try {
    const ctx = await requireContext();
    const alert = can(ctx.membership.role, "fiscal.read") ? await getVerifactuAlert(ctx.company.id) : null;
    return NextResponse.json({ alert }, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch (error) {
    return handleRouteError(error, "verifactu.health");
  }
}
