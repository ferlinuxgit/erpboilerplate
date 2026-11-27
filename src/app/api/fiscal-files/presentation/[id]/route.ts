import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { generatePresentationFile } from "@/server/fiscal-files/presentation-service";

/**
 * Fichero de presentación de un modelo guardado, para importarlo en la sede de la AEAT (texto de
 * longitud fija en ISO-8859-1 según el diseño de registro del modelo).
 * `?tipo=` fuerza el tipo de declaración (I, U, N, C, D…) y `?iban=` la cuenta de domiciliación o
 * devolución. Los avisos que conviene revisar viajan en la cabecera `X-Fiscal-File-Warnings`
 * (JSON codificado en URI). Si faltan datos responde 422 con el detalle.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext("fiscal.read");
    const { id } = await params;
    const url = new URL(request.url);
    const file = await generatePresentationFile({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      reportId: id,
      options: { declarationType: url.searchParams.get("tipo"), iban: url.searchParams.get("iban") },
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
