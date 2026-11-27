import { requireContext } from "@/lib/current-context";
import { handleRouteError, jsonError } from "@/lib/http";
import { assertSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { annualAccountsDocument } from "@/server/accounting/annual-accounts/documents";
import { loadAnnualAccounts } from "@/server/accounting/annual-accounts/service";
import { renderDocumentXlsx } from "@/server/accounting/books/document";
import { isOfficialStatementModelId } from "@/server/accounting/official-statements-model";

/**
 * Cuentas anuales de un ejercicio (balance, pérdidas y ganancias, estado de cambios en el patrimonio
 * neto y memoria) en PDF o Excel. `?year=<id del ejercicio>&format=pdf|xlsx&model=abbreviated|pymes|normal`.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("accounting.read");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "pdf";
    if (format !== "pdf" && format !== "xlsx") return jsonError(400, "Formato no válido: usa pdf o xlsx.");
    const model = url.searchParams.get("model");
    const accounts = await loadAnnualAccounts(ctx.company.id, url.searchParams.get("year") || ctx.fiscalYear.id, { model: isOfficialStatementModelId(model) ? model : undefined });
    const document = annualAccountsDocument(accounts);
    const generatedAt = new Date();
    const bytes = format === "xlsx"
      ? await renderDocumentXlsx(document, generatedAt)
      : await (await import("@/server/accounting/books/document-pdf")).renderDocumentPdf(document, generatedAt);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Disposition": `attachment; filename="cuentas-anuales-${accounts.year.code.replace(/[^0-9A-Za-z-]/g, "")}.${format}"`,
        "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "accounting.annual-accounts.export", "No se pudieron generar las cuentas anuales. Inténtalo de nuevo.");
  }
}
