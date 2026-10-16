/**
 * Modelo de la bandeja de facturas (OCR por lotes): estado de cada documento y cómo se
 * rellenan sus campos a partir de la lectura y de los valores habituales del proveedor.
 * Funciones puras para poder probarlas sin navegador.
 */

import { findAccountForCode, type AccountOption } from "@/lib/account-aliases";
import { parseDecimalInput } from "@/lib/format";
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
  /** Bases por tipo de IVA del pie de la factura (solo si cuadran con el total). */
  taxSummary?: Array<{ taxRate: number; base: number; taxDeductiblePct: number }>;
  /** Tratamiento de IVA propuesto por la lectura (proveedor extranjero sin IVA español). */
  vatTreatment?: SupplierVatTreatment;
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
  /** Documento llegado por correo (remitente y asunto). */
  emailFrom?: string | null;
  emailSubject?: string | null;
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
  /** Fecha de registro; vacía = la de la factura (solo para facturas recibidas tarde). */
  accountingDate: string;
  dueDate: string;
  dueDateEdited: boolean;
  currencyCode: string;
  vatTreatment: SupplierVatTreatment | "";
  /** Conversión a la moneda de la empresa de una factura en otra moneda. */
  exchange?: ExchangeConversion;
  lines: DraftLine[];
  duplicate: DuplicateAssessment;
  acknowledgePossible: boolean;
  acknowledgeBlocking: boolean;
  reviewed: boolean;
  createdExpenseId?: string;
};

export type ExchangeConversion = {
  fromCurrency: string;
  /** 1 unidad de la moneda original = `rate` de la moneda de la empresa. */
  rate: number;
  rateDate: string;
  source: "BCE" | "manual";
  /** Líneas antes de convertir, para poder deshacerlo. */
  originalLines: DraftLine[];
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
    accountingDate: "",
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
  // Sin fecha leída se deja vacía (bloquea el registro hasta indicarla): poner la de hoy llevaría
  // la factura a otro periodo de IVA sin que nadie lo note.
  const issueDate = draft.issueDate?.slice(0, 10) ?? "";
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
  const withSupplier = applySupplierToItem(hydrated, matched);
  // El tratamiento habitual del proveedor manda; si no tiene, el propuesto por la lectura.
  return withSupplier.vatTreatment ? withSupplier : { ...withSupplier, vatTreatment: draft.vatTreatment ?? "" };
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
  /** Llegado por correo: remitente y asunto. */
  emailFrom?: string | null;
  emailSubject?: string | null;
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
    emailFrom: job.emailFrom ?? null,
    emailSubject: job.emailSubject ?? null,
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

const lineBaseCents = (line: Pick<DraftLine, "quantity" | "unitPrice">) => {
  const quantity = parseDecimalInput(line.quantity);
  const unitPrice = parseDecimalInput(line.unitPrice, { maximumFractionDigits: 2 });
  return quantity === null || unitPrice === null ? null : Math.round(quantity * unitPrice * 100);
};

const centsDraft = (cents: number) => decimalDraft((cents / 100).toFixed(2));
const percentKey = (raw: string) => parseDecimalInput(raw, { maximumFractionDigits: 2 }) ?? raw.trim();

function conceptSummary(descriptions: readonly string[], fallback: string) {
  const first = descriptions.find((description) => description.trim())?.trim();
  if (!first) return fallback;
  return descriptions.length > 1 ? `${first} y ${descriptions.length - 1} concepto${descriptions.length > 2 ? "s" : ""} más` : first;
}

/**
 * Agrupa las líneas con la misma cuenta, IVA, % deducible y retención en una sola (base = suma de
 * bases). Para el registro contable da igual el detalle de cada artículo y el total no cambia.
 */
export function groupItemLines(item: BatchItem): BatchItem {
  const groups = new Map<string, DraftLine[]>();
  const order: string[] = [];
  item.lines.forEach((line, index) => {
    const key = lineBaseCents(line) === null
      ? `invalid-${index}`
      : [line.expenseAccountId, percentKey(line.taxRate), percentKey(line.taxDeductiblePct), percentKey(line.retentionRate)].join("|");
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  });
  const lines = order.map((key) => {
    const members = groups.get(key) ?? [];
    if (members.length === 1) return members[0];
    const baseCents = members.reduce((sum, line) => sum + (lineBaseCents(line) ?? 0), 0);
    return {
      ...members[0],
      description: conceptSummary(members.map((line) => line.description), "Compras según factura"),
      quantity: "1",
      unitPrice: centsDraft(baseCents),
      deductibleEdited: members.some((line) => line.deductibleEdited),
    };
  });
  return { ...item, lines };
}

/**
 * Sustituye las líneas por una por tipo de IVA con las bases del pie de la factura (que cuadran con
 * el total). Mantiene la cuenta y la retención de las líneas leídas.
 */
export function applyTaxSummaryLines(item: BatchItem): BatchItem {
  const summary = item.draft?.taxSummary;
  if (!summary?.length) return item;
  const template = item.lines[0];
  return {
    ...item,
    lines: summary.map((entry) => {
      const sameRate = item.lines.filter((line) => parseDecimalInput(line.taxRate, { maximumFractionDigits: 2 }) === entry.taxRate);
      const source = sameRate[0] ?? template;
      return {
        id: crypto.randomUUID(),
        description: conceptSummary(sameRate.map((line) => line.description), `Base al ${decimalDraft(entry.taxRate)} %`),
        expenseAccountId: source?.expenseAccountId ?? "",
        accountSource: source?.accountSource ?? "none",
        quantity: "1",
        unitPrice: centsDraft(Math.round(entry.base * 100)),
        taxRate: decimalDraft(entry.taxRate),
        taxDeductiblePct: source?.deductibleEdited ? source.taxDeductiblePct : decimalDraft(entry.taxDeductiblePct),
        retentionRate: source?.retentionRate ?? "0",
        deductibleEdited: source?.deductibleEdited ?? false,
      };
    }),
  };
}

/**
 * Convierte los importes de una factura en otra moneda a la de la empresa (art. 79.Once LIVA: tipo
 * de cambio del día de la factura). Cada base se convierte entera para no arrastrar redondeos del
 * precio unitario; la cantidad se mantiene si el precio convertido la reproduce.
 */
export function convertItemCurrency(item: BatchItem, baseCurrencyCode: string, conversion: Omit<ExchangeConversion, "fromCurrency" | "originalLines">): BatchItem {
  if (!(conversion.rate > 0) || item.currencyCode === baseCurrencyCode) return item;
  const lines = item.lines.map((line) => {
    const quantity = parseDecimalInput(line.quantity);
    const unitPrice = parseDecimalInput(line.unitPrice, { maximumFractionDigits: 2 });
    if (quantity === null || unitPrice === null) return line;
    const baseCents = Math.round(quantity * unitPrice * conversion.rate * 100);
    const convertedUnitCents = Math.round(unitPrice * conversion.rate * 100);
    if (Math.round(convertedUnitCents * quantity) === baseCents) return { ...line, unitPrice: centsDraft(convertedUnitCents) };
    return { ...line, quantity: "1", unitPrice: centsDraft(baseCents), description: `${line.description} (${line.quantity} × ${line.unitPrice} ${item.currencyCode})` };
  });
  return { ...item, lines, currencyCode: baseCurrencyCode, exchange: { ...conversion, fromCurrency: item.currencyCode, originalLines: item.lines } };
}

export function undoCurrencyConversion(item: BatchItem): BatchItem {
  if (!item.exchange) return item;
  return { ...item, lines: item.exchange.originalLines, currencyCode: item.exchange.fromCurrency, exchange: undefined };
}

/** Total leído expresado en la moneda en la que se va a registrar. */
export function extractedTotalFor(item: BatchItem) {
  const total = item.draft?.totalAmount;
  if (total === undefined || !item.exchange) return total;
  return Math.round(total * item.exchange.rate * 100) / 100;
}

/** Nota que se guarda con la factura convertida: importe original y cambio aplicado. */
export function exchangeNote(item: BatchItem) {
  const exchange = item.exchange;
  if (!exchange) return undefined;
  const original = item.draft?.totalAmount;
  const rate = exchange.rate.toLocaleString("es-ES", { maximumFractionDigits: 6 });
  const date = exchange.rateDate.split("-").reverse().join("/");
  const amount = original === undefined ? "" : `Importe original: ${original.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${exchange.fromCurrency}. `;
  return `${amount}Tipo de cambio ${exchange.source === "BCE" ? `BCE del ${date}` : `indicado a mano (${date})`}: 1 ${exchange.fromCurrency} = ${rate} ${item.currencyCode}.`;
}
