import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { generateGestorPackage } from "@/server/accounting/gestor-package";

/**
 * Paquete para el gestor (ZIP): libro diario con líneas, mayor, sumas y saldos, libros registro de
 * IVA y PDF de los modelos del periodo. `?year=<id del ejercicio>&period=year|q1…q4|m01…m12`.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("accounting.read");
    const url = new URL(request.url);
    const { bytes, fileName } = await generateGestorPackage({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      countryCode: ctx.company.countryCode,
      fiscalYearId: url.searchParams.get("year") || ctx.fiscalYear.id,
      periodKey: url.searchParams.get("period"),
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/zip",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "accounting.gestor-package", "No se pudo generar el paquete para el gestor. Inténtalo de nuevo.");
  }
}
