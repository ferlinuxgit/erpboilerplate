import { requireContext } from "@/lib/current-context";
import { handleRouteError, jsonError } from "@/lib/http";
import { assertSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { exportDiary } from "@/server/accounting/books/service";

/**
 * Diario del ejercicio para programas de despacho: `?year=<id>&format=a3&companyCode=<1-99999>`
 * (fichero SUENLACE.DAT de A3) o `?year=<id>&format=contaplus` (ZIP con XDiario.txt y XSubCta.txt).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("accounting.read");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const url = new URL(request.url);
    const format = url.searchParams.get("format");
    if (format !== "a3" && format !== "contaplus") return jsonError(400, "Formato no válido: usa a3 o contaplus.");
    const companyCode = Number(url.searchParams.get("companyCode"));
    if (format === "a3" && !(Number.isInteger(companyCode) && companyCode >= 1 && companyCode <= 99_999)) {
      return jsonError(400, "Indica el código de la empresa en A3 (un número del 1 al 99999).");
    }
    const { bytes, fileName, contentType } = await exportDiary({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: ctx.user.id, fiscalYearId: url.searchParams.get("year") || ctx.fiscalYear.id, format, a3CompanyCode: companyCode });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Disposition": `attachment; filename="${fileName}"`, "Content-Type": contentType, "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "accounting.books.export", "No se pudo exportar el diario. Inténtalo de nuevo.");
  }
}
