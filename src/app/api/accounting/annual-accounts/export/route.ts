import { requireContext } from "@/lib/current-context";
import { handleRouteError, jsonError } from "@/lib/http";
import { assertSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { annualAccountsDocument, annualAccountsNotesDocument } from "@/server/accounting/annual-accounts/documents";
import { loadAnnualAccounts } from "@/server/accounting/annual-accounts/service";
import { renderDocumentXlsx } from "@/server/accounting/books/document";
import { renderDocumentDocx } from "@/server/accounting/books/document-docx";
import { isOfficialStatementModelId } from "@/server/accounting/official-statements-model";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/**
 * Cuentas anuales de un ejercicio (balance, pérdidas y ganancias, estados de cambios en el patrimonio
 * neto y de flujos de efectivo, y memoria) en PDF, Excel o Word.
 * `?year=<id del ejercicio>&format=pdf|xlsx|docx&model=abbreviated|pymes|normal`; `part=notes` solo
 * la memoria; `cashFlow=1` añade el estado de flujos de efectivo aunque el modelo no lo exija.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("accounting.read");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "pdf";
    if (format !== "pdf" && format !== "xlsx" && format !== "docx") return jsonError(400, "Formato no válido: usa pdf, xlsx o docx.");
    const notesOnly = url.searchParams.get("part") === "notes";
    const model = url.searchParams.get("model");
    const accounts = await loadAnnualAccounts(ctx.company.id, url.searchParams.get("year") || ctx.fiscalYear.id, { model: isOfficialStatementModelId(model) ? model : undefined });
    const document = notesOnly ? annualAccountsNotesDocument(accounts) : annualAccountsDocument(accounts, { includeCashFlow: url.searchParams.get("cashFlow") === "1" });
    const generatedAt = new Date();
    const bytes = format === "xlsx"
      ? await renderDocumentXlsx(document, generatedAt)
      : format === "docx"
        ? renderDocumentDocx(document, generatedAt)
        : await (await import("@/server/accounting/books/document-pdf")).renderDocumentPdf(document, generatedAt);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Disposition": `attachment; filename="${notesOnly ? "memoria" : "cuentas-anuales"}-${accounts.year.code.replace(/[^0-9A-Za-z-]/g, "")}.${format}"`,
        "Content-Type": CONTENT_TYPES[format],
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "accounting.annual-accounts.export", "No se pudieron generar las cuentas anuales. Inténtalo de nuevo.");
  }
}
