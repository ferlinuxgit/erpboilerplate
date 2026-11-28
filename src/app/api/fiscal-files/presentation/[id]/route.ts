import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { generatePresentationFile } from "@/server/fiscal-files/presentation-service";

/**
 * Fichero de presentación de un modelo guardado, para importarlo en la sede de la AEAT (texto de
 * longitud fija en ISO-8859-1 según el diseño de registro del modelo).
 *
 * Parámetros de la descarga (los datos que el programa no guarda):
 * - `?tipo=` fuerza el tipo de declaración (I, U, N, C, D…) y `?iban=` la cuenta de domiciliación
 *   o devolución (autoliquidaciones);
 * - `?provincia=` (dos dígitos): provincia de los perceptores sin ficha con código postal (190, 180, 193);
 * - `?exonerado390=1`, `?actividad=` (A01…C), `?iae=` y `?con347=1`: volumen de operaciones del
 *   303 del último periodo para quien no presenta el 390;
 * - `?cnae=` (cuatro dígitos): página de prorratas del 303 del último periodo.
 * Los avisos que conviene revisar viajan en la cabecera `X-Fiscal-File-Warnings` (JSON codificado
 * en URI). Si faltan datos responde 422 con el detalle.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext("fiscal.read");
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const isYes = (value: string | null) => ["1", "true", "si", "sí"].includes((value ?? "").toLowerCase());
    const file = await generatePresentationFile({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      reportId: id,
      options: {
        declarationType: searchParams.get("tipo"),
        iban: searchParams.get("iban"),
        defaultProvince: searchParams.get("provincia"),
        exemptFrom390: isYes(searchParams.get("exonerado390")),
        activityCode: searchParams.get("actividad"),
        iaeCode: searchParams.get("iae"),
        has347Operations: isYes(searchParams.get("con347")),
        cnae: searchParams.get("cnae"),
      },
    });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Type": "text/plain; charset=iso-8859-1",
        "Cache-Control": "no-store",
        "X-Fiscal-File-Warnings": encodeURIComponent(JSON.stringify(file.warnings)),
        "X-Fiscal-File-Source": file.source,
      },
    });
  } catch (error) {
    return handleRouteError(error, "fiscal-files.presentation", "No se pudo generar el fichero para la sede de la AEAT. Inténtalo de nuevo.");
  }
}
