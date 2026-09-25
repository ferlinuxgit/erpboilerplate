/**
 * Modelo de la bandeja de facturas (OCR por lotes): estado de cada documento y cómo se
 * rellenan sus campos a partir de la lectura y de los valores habituales del proveedor.
 * Funciones puras para poder probarlas sin navegador.
 */

import { findAccountForCode, type AccountOption } from "@/lib/account-aliases";
import { normalizeTaxIdentity } from "@/lib/expense-dedup";
import type { SupplierVatTreatment } from "@/lib/fiscal-spain";
import { applySupplierDefaultsToLine, dueDateInputFor, type AccountSource, type SupplierDefaults } from "@/lib/supplier-defaults";

import type { ReviewLine } from "./expense-review";

export type BatchSupplier = {
  id: string;
  number: string;
  name: string;
  taxId: string | null;
  countryCode?: string | null;
  defaults?: SupplierDefaults;
};

export type DuplicateAssessment = {
  level: "none" | "possible" | "exact";
  matches: Array<{ invoiceId: string; number: string; reason: "file" | "supplier-number" | "date-total" }>;
};

export type OcrDraft = {
  supplierName?: string;
  supplierTaxId?: string;
  supplierCountryCode?: string;
  supplierDocumentNumber?: string;
  currencyCode?: string;
  issueDate?: string;
  dueDate?: string;
  retentionAmount?: number;
  totalAmount?: number;
  lines: Array<{ description: string; quantity: number; unitPrice: number; taxRate: number; taxDeductiblePct: number; retentionRate: number; suggestedExpenseAccountCode?: string }>;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

export type DraftLine = ReviewLine & {
  id: string;
  /** El usuario cambió a mano el % deducible: los valores del proveedor ya no lo pisan. */
  deductibleEdited: boolean;
};

export type BatchStatus = "WAITING" | "UPLOADING" | "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "POSTING" | "POSTED";

export type BatchItem = {
  localId: string;
  jobId?: string;
  batchId?: string;
  /** Archivo local (solo en la sesión en la que se subió). */
  file?: File;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  /** URL privada del original almacenado (disponible tras la subida). */
  fileUrl?: string;
  provider?: string | null;
  status: BatchStatus;
  error?: string;
  draft?: OcrDraft;
  hydrated: boolean;
  supplierPartnerId: string;
  purchaseOrderId: string;
  goodsReceiptId: string;
  supplierName: string;
  supplierTaxId: string;
  supplierCountryCode: string;
  supplierDocumentNumber: string;
  issueDate: string;
  dueDate: string;
  dueDateEdited: boolean;
  currencyCode: string;
  vatTreatment: SupplierVatTreatment | "";
  lines: DraftLine[];
  duplicate: DuplicateAssessment;
  acknowledgePossible: boolean;
  acknowledgeBlocking: boolean;
  reviewed: boolean;
  createdExpenseId?: string;
};

export const emptyDuplicate: DuplicateAssessment = { level: "none", matches: [] };

export const PROCESSING_STATUSES: readonly BatchStatus[] = ["WAITING", "UPLOADING", "PENDING", "PROCESSING"];

/** Coma decimal española para que "1.125" leído por el OCR no se tome como miles. */
export function decimalDraft(value: number | string) {
  return String(value).trim().replace(".", ",");
}

export function todayInput() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function newBatchItem(input: { file?: File; fileName: string; sizeBytes: number; contentType: string; status?: BatchStatus }): BatchItem {
  return {
    localId: crypto.randomUUID(),
    file: input.file,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    contentType: input.contentType,
    status: input.status ?? "WAITING",
    hydrated: false,
    supplierPartnerId: "",
    purchaseOrderId: "",
    goodsReceiptId: "",
    supplierName: "",
    supplierTaxId: "",
    supplierCountryCode: "ES",
    supplierDocumentNumber: "",
    issueDate: todayInput(),
    dueDate: "",
    dueDateEdited: false,
    currencyCode: "EUR",
    vatTreatment: "",
    lines: [],
    duplicate: emptyDuplicate,
    acknowledgePossible: false,
    acknowledgeBlocking: false,
    reviewed: false,
  };
}

export function matchSupplierByTaxId(suppliers: readonly BatchSupplier[], taxId: string | undefined, countryCode: string | undefined) {
  const normalized = normalizeTaxIdentity(taxId, countryCode ?? "ES");
  if (!normalized) return undefined;
  return suppliers.find((supplier) => normalizeTaxIdentity(supplier.taxId, countryCode ?? "ES") === normalized);
}

function accountSourceFor(provider: string | null | undefined): AccountSource {
  return provider === "openai" ? "ai" : "ocr";
}

/** Aplica los valores del proveedor a un documento (sin pisar lo leído ni lo tocado a mano). */
export function applySupplierToItem(item: BatchItem, supplier: BatchSupplier | undefined): BatchItem {
  const defaults = supplier?.defaults;
  if (!defaults) return item;
  const documentHasRetention = (item.draft?.retentionAmount ?? 0) > 0;
  return {
    ...item,
    vatTreatment: item.vatTreatment || defaults.defaultVatTreatment || "",
    dueDate: item.dueDateEdited || item.draft?.dueDate ? item.dueDate : dueDateInputFor(item.issueDate, defaults.paymentTermsDays) || item.dueDate,
    lines: item.lines.map((line) => applySupplierDefaultsToLine(line, defaults, { documentHasRetention, userEditedDeductible: line.deductibleEdited })),
  };
}

/**
 * Rellena el documento con la lectura del OCR/IA. La cuenta solo se propone si la lectura la
 * sugiere (o el proveedor tiene una habitual): nunca se elige la primera del plan en silencio.
 */
export function hydrateItem(
  item: BatchItem,
  draft: OcrDraft,
  duplicate: DuplicateAssessment,
  context: { expenseAccounts: readonly AccountOption[]; suppliers: readonly BatchSupplier[] },
): BatchItem {
  if (item.hydrated) return { ...item, status: item.status === "POSTED" || item.status === "POSTING" ? item.status : "DONE", duplicate: item.duplicate.level === "none" ? duplicate : item.duplicate };
  const matched = matchSupplierByTaxId(context.suppliers, draft.supplierTaxId, draft.supplierCountryCode);
  const source = accountSourceFor(item.provider);
  const issueDate = draft.issueDate?.slice(0, 10) ?? todayInput();
  const hydrated: BatchItem = {
    ...item,
    status: "DONE",
    draft,
    hydrated: true,
    supplierPartnerId: matched?.id ?? "",
    supplierName: matched ? "" : draft.supplierName ?? "",
    supplierTaxId: matched ? "" : draft.supplierTaxId ?? "",
    supplierCountryCode: draft.supplierCountryCode ?? "ES",
    supplierDocumentNumber: draft.supplierDocumentNumber ?? "",
    issueDate,
    dueDate: draft.dueDate?.slice(0, 10) ?? "",
    currencyCode: (draft.currencyCode ?? "EUR").slice(0, 3).toUpperCase(),
    lines: draft.lines.map((line) => {
      const suggested = findAccountForCode(context.expenseAccounts, line.suggestedExpenseAccountCode);
      return {
        id: crypto.randomUUID(),
        description: line.description,
        expenseAccountId: suggested?.id ?? "",
        accountSource: suggested ? source : "none",
        quantity: decimalDraft(line.quantity),
        unitPrice: decimalDraft(line.unitPrice),
        taxRate: decimalDraft(line.taxRate),
        taxDeductiblePct: decimalDraft(line.taxDeductiblePct),
        retentionRate: decimalDraft(line.retentionRate),
        deductibleEdited: false,
      };
    }),
    duplicate,
  };
  return applySupplierToItem(hydrated, matched);
}

/** Estado local de un documento guardado en el servidor (bandeja restaurada). */
export type InboxJob = {
  id: string;
  batchId: string | null;
  status: string;
  fileName: string;
  fileUrl: string | null;
  contentType: string;
  sizeBytes: number | null;
  extractionProvider: string | null;
  errorMessage: string | null;
  extracted: OcrDraft | null;
  duplicateAssessment: DuplicateAssessment;
  supplierInvoiceId?: string | null;
};

export function itemFromInboxJob(job: InboxJob, context: { expenseAccounts: readonly AccountOption[]; suppliers: readonly BatchSupplier[] }): BatchItem {
  const base: BatchItem = {
    ...newBatchItem({ fileName: job.fileName, sizeBytes: job.sizeBytes ?? 0, contentType: job.contentType, status: "PENDING" }),
    // Id estable (igual en servidor y cliente) para no romper la hidratación.
    localId: job.id,
    jobId: job.id,
    batchId: job.batchId ?? undefined,
    fileUrl: job.fileUrl ?? `/api/expenses/ocr/${job.id}/file`,
    provider: job.extractionProvider,
  };
  if (job.supplierInvoiceId) return { ...base, status: "POSTED", createdExpenseId: job.supplierInvoiceId };
  if (job.status === "FAILED") return { ...base, status: "FAILED", error: job.errorMessage ?? "No se pudo analizar el archivo." };
  if (job.status === "DONE" && job.extracted) return hydrateItem(base, job.extracted, job.duplicateAssessment, context);
  return { ...base, status: job.status === "PROCESSING" ? "PROCESSING" : "PENDING" };
}

/** Aplica al estado local el progreso devuelto por el servidor para ese documento. */
export function mergeJobProgress(
  item: BatchItem,
  job: Pick<InboxJob, "status" | "errorMessage" | "extracted" | "duplicateAssessment" | "supplierInvoiceId" | "extractionProvider">,
  context: { expenseAccounts: readonly AccountOption[]; suppliers: readonly BatchSupplier[] },
): BatchItem {
  if (item.status === "POSTED" || item.status === "POSTING") return item;
  if (job.supplierInvoiceId) return { ...item, status: "POSTED", createdExpenseId: job.supplierInvoiceId };
  if (job.status === "FAILED") return { ...item, status: "FAILED", error: job.errorMessage ?? "No se pudo analizar el archivo." };
  if (job.status === "DONE" && job.extracted) {
    return hydrateItem({ ...item, provider: item.provider ?? job.extractionProvider }, job.extracted, job.duplicateAssessment, context);
  }
  return { ...item, status: job.status === "PROCESSING" ? "PROCESSING" : "PENDING" };
}
