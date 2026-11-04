import { handleRouteError, HttpError } from "@/lib/http";
import { recordAdvisorAudit, requireAdvisorApi } from "@/server/advisor/auth";
import { findAdvisorSalesInvoice } from "@/server/advisor/data";
import { fileResponse } from "@/server/advisor/http";
import { getInvoicePdf } from "@/server/invoices/stored-pdf";

/** PDF de una factura emitida (la copia conservada al emitirla). `?view=1` la abre en el navegador. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAdvisorApi("sales");
    const { id } = await params;
    const found = await findAdvisorSalesInvoice(context.company.id, id);
    if (!found) throw new HttpError(404, "Factura no encontrada.");
    const pdf = await getInvoicePdf(context.company.id, id);
    if (!pdf) throw new HttpError(404, "No se pudo generar el PDF de la factura.");
    await recordAdvisorAudit(context, "advisor.download", { kind: "sales-pdf", number: found.number });
    const view = new URL(request.url).searchParams.get("view") === "1";
    return fileResponse({ bytes: new Uint8Array(pdf.bytes), fileName: pdf.fileName, contentType: "application/pdf" }, view ? "inline" : "attachment");
  } catch (error) {
    return handleRouteError(error, "advisor.sales.pdf", "No se pudo descargar la factura.");
  }
}
