import { handleRouteError, HttpError } from "@/lib/http";
import { requireAdvisorApi } from "@/server/advisor/auth";
import { ADVISOR_BOOKS, exportAdvisorBook, isAdvisorBookKey } from "@/server/advisor/exports";
import { auditedFile, requestPeriod } from "@/server/advisor/http";

/** Libros del periodo: diario, mayor, sumas y saldos, registros de IVA o el paquete completo. */
export async function GET(request: Request, { params }: { params: Promise<{ book: string }> }) {
  try {
    const { book } = await params;
    if (!isAdvisorBookKey(book)) throw new HttpError(404, "Libro no encontrado.");
    const context = await requireAdvisorApi(ADVISOR_BOOKS[book].scope);
    const url = new URL(request.url);
    const period = await requestPeriod(context, { year: url.searchParams.get("year"), period: url.searchParams.get("period") });
    const file = await exportAdvisorBook(context, period, book);
    return auditedFile(context, `book-${book}`, file, { period: period.period.label });
  } catch (error) {
    return handleRouteError(error, "advisor.books", "No se pudo generar el libro. Inténtalo de nuevo.");
  }
}
