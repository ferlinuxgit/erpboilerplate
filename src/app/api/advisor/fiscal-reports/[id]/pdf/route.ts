import { handleRouteError, HttpError } from "@/lib/http";
import { isSpanishFiscalModelCode } from "@/lib/fiscal-spain";
import { requireAdvisorApi } from "@/server/advisor/auth";
import { auditedFile } from "@/server/advisor/http";
import { getFiscalReport, resolveFiscalReportSummary } from "@/server/fiscal/service";
import { renderFiscalReportPdf } from "@/server/pdf/render";

/**
 * PDF de un modelo fiscal preparado (mismas casillas que en la ficha del modelo). Un modelo
 * presentado sale de la foto de lo presentado, no del cálculo con los datos de hoy.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAdvisorApi("taxes");
    const { id } = await params;
    const report = await getFiscalReport(context.company.id, id);
    if (!report || !isSpanishFiscalModelCode(report.code)) throw new HttpError(404, "Modelo no encontrado.");
    const resolved = await resolveFiscalReportSummary(context.company.id, report);
    if (!resolved) throw new HttpError(404, "Modelo no encontrado.");
    const pdf = await renderFiscalReportPdf({ companyName: context.company.name, summary: resolved.summary });
    return auditedFile(context, "fiscal-report-pdf", { bytes: new Uint8Array(pdf), fileName: `modelo-${report.code}-${report.period}.pdf`, contentType: "application/pdf" }, { code: report.code, period: report.period });
  } catch (error) {
    return handleRouteError(error, "advisor.fiscal-report.pdf", "No se pudo generar el PDF del modelo.");
  }
}
