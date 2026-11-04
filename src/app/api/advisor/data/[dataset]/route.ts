import { handleRouteError, HttpError } from "@/lib/http";
import { requireAdvisorApi } from "@/server/advisor/auth";
import { ADVISOR_DATASETS, exportAdvisorDataset, isAdvisorDatasetKey } from "@/server/advisor/exports";
import { auditedFile, requestPeriod } from "@/server/advisor/http";

/** Listados del periodo en Excel: clientes, proveedores, cobros, pagos, bancos y cierres de caja. */
export async function GET(request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  try {
    const { dataset } = await params;
    if (!isAdvisorDatasetKey(dataset)) throw new HttpError(404, "Listado no encontrado.");
    const context = await requireAdvisorApi(ADVISOR_DATASETS[dataset].scope);
    const url = new URL(request.url);
    const period = await requestPeriod(context, { year: url.searchParams.get("year"), period: url.searchParams.get("period") });
    const file = await exportAdvisorDataset(context, period, dataset);
    return auditedFile(context, `data-${dataset}`, file, { period: period.period.label });
  } catch (error) {
    return handleRouteError(error, "advisor.data", "No se pudo generar el listado. Inténtalo de nuevo.");
  }
}
