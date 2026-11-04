import { handleRouteError } from "@/lib/http";
import { requireAdvisorApi } from "@/server/advisor/auth";
import { exportAdvisorFullPackage } from "@/server/advisor/exports";
import { auditedFile, requestPeriod } from "@/server/advisor/http";

/** Toda la documentación del periodo en un ZIP (según las secciones del acceso). */
export async function GET(request: Request) {
  try {
    const context = await requireAdvisorApi();
    const url = new URL(request.url);
    const period = await requestPeriod(context, { year: url.searchParams.get("year"), period: url.searchParams.get("period") });
    const file = await exportAdvisorFullPackage(context, period);
    return auditedFile(context, "full-package", file, { period: period.period.label });
  } catch (error) {
    return handleRouteError(error, "advisor.package", "No se pudo preparar la documentación del periodo. Prueba con un periodo más corto.");
  }
}
