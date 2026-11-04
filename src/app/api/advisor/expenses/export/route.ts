import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requireAdvisorApi } from "@/server/advisor/auth";
import { exportAdvisorExpenses } from "@/server/advisor/exports";
import { auditedFile, parseSelectedIds, requestPeriod } from "@/server/advisor/http";

/**
 * Facturas recibidas del periodo. GET: todo el filtro (`q`); POST: las seleccionadas (`ids`).
 * `format=zip` incluye los documentos originales; `format=xlsx` (por defecto), solo el listado.
 */
export async function GET(request: Request) {
  try {
    const context = await requireAdvisorApi("expenses");
    const url = new URL(request.url);
    const period = await requestPeriod(context, { year: url.searchParams.get("year"), period: url.searchParams.get("period") });
    const q = url.searchParams.get("q")?.slice(0, 200) ?? "";
    const withDocuments = url.searchParams.get("format") === "zip";
    const file = await exportAdvisorExpenses(context, period, { q, withDocuments });
    return auditedFile(context, withDocuments ? "expenses-zip" : "expenses-xlsx", file, { period: period.period.label, q: q || undefined });
  } catch (error) {
    return handleRouteError(error, "advisor.expenses.export", "No se pudo preparar la descarga de facturas recibidas.");
  }
}

const selectionSchema = z.object({ year: z.string().max(64).optional(), period: z.string().max(8).optional(), ids: z.array(z.string()), format: z.enum(["zip", "xlsx"]).default("zip") });

export async function POST(request: Request) {
  try {
    const context = await requireAdvisorApi("expenses");
    const parsed = selectionSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return invalidJsonResponse("Selecciona las facturas que quieres descargar.");
    const ids = parseSelectedIds(parsed.data.ids);
    const period = await requestPeriod(context, parsed.data);
    const withDocuments = parsed.data.format === "zip";
    const file = await exportAdvisorExpenses(context, period, { q: "", ids, withDocuments });
    return auditedFile(context, withDocuments ? "expenses-zip" : "expenses-xlsx", file, { period: period.period.label, selected: ids.length });
  } catch (error) {
    return handleRouteError(error, "advisor.expenses.export", "No se pudo preparar la descarga de facturas recibidas.");
  }
}
