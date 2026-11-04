import { handleRouteError, HttpError } from "@/lib/http";
import { isSpanishFiscalModelCode } from "@/lib/fiscal-spain";
import { requireAdvisorApi } from "@/server/advisor/auth";
import { auditedFile } from "@/server/advisor/http";
import { getFiscalReport } from "@/server/fiscal/service";
import { calculateSpanishFiscalSummary } from "@/server/fiscal/spain";
import { renderFiscalReportPdf } from "@/server/pdf/render";

/** PDF de un modelo fiscal preparado (mismas casillas que en la ficha del modelo). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAdvisorApi("taxes");
    const { id } = await params;
    const report = await getFiscalReport(context.company.id, id);
    if (!report || !isSpanishFiscalModelCode(report.code)) throw new HttpError(404, "Modelo no encontrado.");
    const summary = await calculateSpanishFiscalSummary(context.company.id, report.code, report.period);
    const pdf = await renderFiscalReportPdf({ companyName: context.company.name, summary });
    return auditedFile(context, "fiscal-report-pdf", { bytes: new Uint8Array(pdf), fileName: `modelo-${report.code}-${report.period}.pdf`, contentType: "application/pdf" }, { code: report.code, period: report.period });
  } catch (error) {
    return handleRouteError(error, "advisor.fiscal-report.pdf", "No se pudo generar el PDF del modelo.");
  }
}
