import type { ExpenseOcrDraft } from "@/server/ocr/expense-ocr";
import { assessExpenseDuplicate, type ExpenseDuplicateAssessment } from "@/server/supplier-invoices/service";

/** Añade a cada documento analizado su evaluación de duplicados (archivo, número, fecha+importe). */
export async function withDuplicateAssessment<T extends { extracted: ExpenseOcrDraft | null; documentSha256: string | null }>(
  companyId: string,
  jobs: readonly T[],
): Promise<Array<T & { duplicateAssessment: ExpenseDuplicateAssessment }>> {
  return Promise.all(jobs.map(async (job) => {
    const draft = job.extracted;
    const duplicateAssessment: ExpenseDuplicateAssessment = draft
      ? await assessExpenseDuplicate({
          companyId,
          supplierTaxId: draft.supplierTaxId,
          supplierName: draft.supplierName,
          supplierCountryCode: draft.supplierCountryCode,
          supplierDocumentNumber: draft.supplierDocumentNumber,
          issueDate: draft.issueDate ? new Date(draft.issueDate) : undefined,
          totalAmount: draft.totalAmount,
          documentSha256: job.documentSha256 ?? undefined,
        })
      : { level: "none", matches: [] };
    return { ...job, duplicateAssessment };
  }));
}
