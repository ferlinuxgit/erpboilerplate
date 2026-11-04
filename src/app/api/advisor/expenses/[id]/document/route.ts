import { handleRouteError, HttpError } from "@/lib/http";
import { recordAdvisorAudit, requireAdvisorApi } from "@/server/advisor/auth";
import { listAdvisorExpenseDocuments } from "@/server/advisor/data";
import { fileResponse } from "@/server/advisor/http";
import { readExpenseOcrFile } from "@/server/ocr/expense-ocr";

/** Documento original de una factura recibida (`?n=` si tiene varios; `?view=1` para abrirlo). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAdvisorApi("expenses");
    const { id } = await params;
    const url = new URL(request.url);
    const documents = await listAdvisorExpenseDocuments(context.company.id, id);
    const index = Math.max(0, Math.min(documents.length - 1, Number.parseInt(url.searchParams.get("n") ?? "0", 10) || 0));
    const document = documents[index];
    if (!document) throw new HttpError(404, "Esta factura no tiene documento adjunto.");
    const bytes = await readExpenseOcrFile(document).catch(() => {
      throw new HttpError(404, "No se encontró el archivo del documento. Pide a la empresa que lo vuelva a subir.");
    });
    await recordAdvisorAudit(context, "advisor.download", { kind: "expense-document", supplierInvoiceId: id, file: document.fileName });
    const view = url.searchParams.get("view") === "1";
    return fileResponse({ bytes: new Uint8Array(bytes), fileName: document.fileName, contentType: document.contentType || "application/octet-stream" }, view ? "inline" : "attachment");
  } catch (error) {
    return handleRouteError(error, "advisor.expenses.document", "No se pudo descargar el documento.");
  }
}
