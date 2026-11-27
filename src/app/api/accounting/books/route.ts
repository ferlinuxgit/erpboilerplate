import { requireContext } from "@/lib/current-context";
import { handleRouteError, jsonError } from "@/lib/http";
import { assertSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { generateBook } from "@/server/accounting/books/service";

const BOOKS = ["journal", "inventory", "ledger"] as const;

/**
 * Un libro oficial del ejercicio para revisarlo: `?year=<id>&book=journal|inventory|ledger&format=xlsx|pdf`.
 * El juego para legalizar (con huellas) se genera en `POST /api/accounting/books/package`.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("accounting.read");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const url = new URL(request.url);
    const book = url.searchParams.get("book");
    const format = url.searchParams.get("format") ?? "xlsx";
    if (!BOOKS.includes(book as (typeof BOOKS)[number])) return jsonError(400, "Libro no válido: usa journal, inventory o ledger.");
    if (format !== "pdf" && format !== "xlsx") return jsonError(400, "Formato no válido: usa pdf o xlsx.");
    const { bytes, fileName, contentType } = await generateBook({ companyId: ctx.company.id, fiscalYearId: url.searchParams.get("year") || ctx.fiscalYear.id, kind: book as (typeof BOOKS)[number], format });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Disposition": `attachment; filename="${fileName}"`, "Content-Type": contentType, "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "accounting.books.download", "No se pudo generar el libro. Inténtalo de nuevo.");
  }
}
