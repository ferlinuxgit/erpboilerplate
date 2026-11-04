import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requireAdvisorApi } from "@/server/advisor/auth";
import { exportAdvisorSales } from "@/server/advisor/exports";
import { auditedFile, parseSelectedIds, requestPeriod } from "@/server/advisor/http";

/**
 * Facturas emitidas del periodo. GET: todo el filtro (`q`); POST: las seleccionadas (`ids`).
 * `format=zip` incluye los PDF; `format=xlsx` (por defecto), solo el listado.
 */
export async function GET(request: Request) {
  try {
    const context = await requireAdvisorApi("sales");
    const url = new URL(request.url);
    const period = await requestPeriod(context, { year: url.searchParams.get("year"), period: url.searchParams.get("period") });
    const q = url.searchParams.get("q")?.slice(0, 200) ?? "";
    const withPdfs = url.searchParams.get("format") === "zip";
    const file = await exportAdvisorSales(context, period, { q, withPdfs });
    return auditedFile(context, withPdfs ? "sales-zip" : "sales-xlsx", file, { period: period.period.label, q: q || undefined });
  } catch (error) {
    return handleRouteError(error, "advisor.sales.export", "No se pudo preparar la descarga de facturas emitidas.");
  }
}

const selectionSchema = z.object({ year: z.string().max(64).optional(), period: z.string().max(8).optional(), ids: z.array(z.string()), format: z.enum(["zip", "xlsx"]).default("zip") });

export async function POST(request: Request) {
  try {
    const context = await requireAdvisorApi("sales");
    const parsed = selectionSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return invalidJsonResponse("Selecciona las facturas que quieres descargar.");
    const ids = parseSelectedIds(parsed.data.ids);
    const period = await requestPeriod(context, parsed.data);
    const withPdfs = parsed.data.format === "zip";
    const file = await exportAdvisorSales(context, period, { q: "", ids, withPdfs });
    return auditedFile(context, withPdfs ? "sales-zip" : "sales-xlsx", file, { period: period.period.label, selected: ids.length });
  } catch (error) {
    return handleRouteError(error, "advisor.sales.export", "No se pudo preparar la descarga de facturas emitidas.");
  }
}
