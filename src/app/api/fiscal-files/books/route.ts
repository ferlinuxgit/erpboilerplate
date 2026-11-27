import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { generateLsiBooks } from "@/server/fiscal-files/lsi-service";

const param = (url: URL, name: string, maxLength: number) => url.searchParams.get(name)?.trim().slice(0, maxLength) || null;

/**
 * Libros registro de IVA (y de IRPF para autónomos) en el formato electrónico de la AEAT (XLSX):
 * facturas expedidas, recibidas y bienes de inversión, desde el 1 de enero hasta el final del
 * trimestre pedido. `?year=2026&quarter=1…4` y, opcionalmente, la actividad de los asientos
 * (`activityCode` A-D, `activityType` 01-06, `iae` grupo o epígrafe).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("accounting.read");
    const url = new URL(request.url);
    const result = await generateLsiBooks({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      year: Number(url.searchParams.get("year")),
      quarter: Number(url.searchParams.get("quarter") ?? 4) || 4,
      activity: { code: param(url, "activityCode", 1), type: param(url, "activityType", 2), iaeGroup: param(url, "iae", 4) },
    });
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        // El nombre oficial puede llevar Ñ: va codificado (RFC 5987) y con una alternativa ASCII.
        "Content-Disposition": `attachment; filename="libros-registro-aeat.xlsx"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
        "X-Lsi-Rows": `${result.counts.issued},${result.counts.received},${result.counts.assets}`,
      },
    });
  } catch (error) {
    return handleRouteError(error, "fiscal-files.books", "No se pudieron generar los libros en formato de la AEAT. Inténtalo de nuevo.");
  }
}
