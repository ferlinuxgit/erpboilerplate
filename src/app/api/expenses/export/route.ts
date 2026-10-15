import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { parseListParams } from "@/lib/list-params";
import { generateExpenseExport } from "@/server/supplier-invoices/export";
import { expenseInvoiceListConfig } from "@/server/supplier-invoices/list";

/**
 * Exportación de facturas de proveedor para el asesor, con los filtros del listado
 * (`from`, `to`, `q`, `status`). `documents=1` devuelve un ZIP con el Excel y los documentos
 * originales; si no, solo el Excel.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("expense.read");
    const url = new URL(request.url);
    const params = parseListParams(Object.fromEntries(url.searchParams), expenseInvoiceListConfig);
    const result = await generateExpenseExport({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      filters: { from: params.from, to: params.to, q: params.q, status: params.filters.status ?? null },
      includeDocuments: url.searchParams.get("documents") === "1",
    });
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Content-Type": result.contentType,
        "Cache-Control": "no-store",
        "X-Missing-Documents": String(result.missing.length),
      },
    });
  } catch (error) {
    return handleRouteError(error, "expenses.export", "No se pudo generar la exportación de facturas. Inténtalo de nuevo.");
  }
}
