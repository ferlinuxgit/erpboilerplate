"use client";

import { ArrowLeft, CheckCircle, FileText, SpinnerGap, UploadSimple, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput, QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { normalizeTaxIdentity } from "@/lib/expense-dedup";
import { formatAmount, formatMoney, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";

type ExpenseAccount = { id: string; code: string; name: string };
type Supplier = { id: string; number: string; name: string; taxId: string | null };
type PurchaseOrderRelation = { id: string; number: string; supplierPartnerId: string };
type GoodsReceiptRelation = { id: string; number: string; purchaseOrderId: string; supplierPartnerId: string };
type DuplicateAssessment = {
  level: "none" | "possible" | "exact";
  matches: Array<{ invoiceId: string; number: string; reason: "file" | "supplier-number" | "date-total" }>;
};
type DraftLine = {
  id: string;
  description: string;
  expenseAccountId: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  taxDeductiblePct: string;
  retentionRate: string;
};
type OcrDraft = {
  supplierName?: string;
  supplierTaxId?: string;
  supplierCountryCode?: string;
  supplierDocumentNumber?: string;
  currencyCode?: string;
  issueDate?: string;
  dueDate?: string;
  totalAmount?: number;
  lines: Array<{ description: string; quantity: number; unitPrice: number; taxRate: number; taxDeductiblePct: number; retentionRate: number; suggestedExpenseAccountCode?: string }>;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};
type BatchItem = {
  localId: string;
  file: File;
  jobId?: string;
  status: "WAITING" | "UPLOADING" | "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "POSTING" | "POSTED";
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
  currencyCode: string;
  lines: DraftLine[];
  duplicate: DuplicateAssessment;
  acknowledgePossible: boolean;
  acknowledgeBlocking: boolean;
  createdExpenseId?: string;
};

type Props = {
  baseCurrencyCode: string;
  expenseAccounts: ExpenseAccount[];
  goodsReceipts: GoodsReceiptRelation[];
  purchaseOrders: PurchaseOrderRelation[];
  suppliers: Supplier[];
  onBack: () => void;
};

const emptyDuplicate: DuplicateAssessment = { level: "none", matches: [] };
const confidenceLabels: Record<OcrDraft["confidence"], string> = { high: "alta", medium: "media", low: "baja" };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

/** Drafts keep the Spanish decimal comma so OCR values such as 1.125 are never read as thousands. */
function decimalDraft(value: number | string) {
  return String(value).trim().replace(".", ",");
}

const parseQuantity = (raw: string) => parseDecimalInput(raw) ?? Number.NaN;
const parseMoney = (raw: string) => parseDecimalInput(raw, { maximumFractionDigits: 2 }) ?? Number.NaN;
const parsePercent = (raw: string) => parseDecimalInput(raw, { maximumFractionDigits: 2 }) ?? Number.NaN;

function lineTotal(line: DraftLine) {
  const subtotal = parseQuantity(line.quantity) * parseMoney(line.unitPrice);
  const tax = subtotal * parsePercent(line.taxRate) / 100;
  const retention = subtotal * parsePercent(line.retentionRate) / 100;
  return Number.isFinite(subtotal + tax - retention) ? subtotal + tax - retention : 0;
}

const lineNumberFields = [
  { field: "quantity", label: "Cantidad", kind: "quantity" },
  { field: "unitPrice", label: "Base", kind: "money" },
  { field: "taxRate", label: "IVA", kind: "percent" },
  { field: "taxDeductiblePct", label: "Deducible", kind: "percent" },
  { field: "retentionRate", label: "Retención", kind: "percent" },
] as const;

function statusLabel(status: BatchItem["status"]) {
  return {
    WAITING: "En cola",
    UPLOADING: "Subiendo",
    PENDING: "Pendiente",
    PROCESSING: "Analizando",
    DONE: "Revisar",
    FAILED: "Error",
    POSTING: "Contabilizando",
    POSTED: "Registrado",
  }[status];
}

export function ExpenseBatchUpload({ baseCurrencyCode, expenseAccounts, goodsReceipts, purchaseOrders, suppliers, onBack }: Props) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [engine, setEngine] = useState<"local" | "openai">("local");
  const [isStarting, setIsStarting] = useState(false);
  const pollingGeneration = useRef(0);

  const counts = useMemo(() => ({
    total: items.length,
    processing: items.filter((item) => ["WAITING", "UPLOADING", "PENDING", "PROCESSING"].includes(item.status)).length,
    review: items.filter((item) => item.status === "DONE").length,
    posted: items.filter((item) => item.status === "POSTED").length,
    failed: items.filter((item) => item.status === "FAILED").length,
  }), [items]);

  function patchItem(localId: string, patch: Partial<BatchItem>) {
    setItems((current) => current.map((item) => item.localId === localId ? { ...item, ...patch } : item));
  }

  function patchLine(localId: string, lineId: string, patch: Partial<DraftLine>) {
    setItems((current) => current.map((item) => item.localId !== localId ? item : {
      ...item,
      lines: item.lines.map((line) => line.id === lineId ? { ...line, ...patch } : line),
    }));
  }

  function selectItemSupplier(item: BatchItem, supplierPartnerId: string) {
    const linkedOrder = purchaseOrders.find((order) => order.id === item.purchaseOrderId);
    patchItem(item.localId, {
      supplierPartnerId,
      purchaseOrderId: linkedOrder && linkedOrder.supplierPartnerId !== supplierPartnerId ? "" : item.purchaseOrderId,
      goodsReceiptId: linkedOrder && linkedOrder.supplierPartnerId !== supplierPartnerId ? "" : item.goodsReceiptId,
      duplicate: emptyDuplicate,
    });
  }

  function selectItemPurchaseOrder(item: BatchItem, purchaseOrderId: string) {
    const order = purchaseOrders.find((candidate) => candidate.id === purchaseOrderId);
    const receiptBelongsToOrder = goodsReceipts.find((receipt) => receipt.id === item.goodsReceiptId)?.purchaseOrderId === purchaseOrderId;
    patchItem(item.localId, {
      purchaseOrderId,
      goodsReceiptId: receiptBelongsToOrder ? item.goodsReceiptId : "",
      supplierPartnerId: order?.supplierPartnerId ?? item.supplierPartnerId,
      supplierName: order ? "" : item.supplierName,
      supplierTaxId: order ? "" : item.supplierTaxId,
      duplicate: emptyDuplicate,
    });
  }

  function selectItemGoodsReceipt(item: BatchItem, goodsReceiptId: string) {
    const receipt = goodsReceipts.find((candidate) => candidate.id === goodsReceiptId);
    patchItem(item.localId, {
      goodsReceiptId,
      purchaseOrderId: receipt?.purchaseOrderId ?? item.purchaseOrderId,
      supplierPartnerId: receipt?.supplierPartnerId ?? item.supplierPartnerId,
      supplierName: receipt ? "" : item.supplierName,
      supplierTaxId: receipt ? "" : item.supplierTaxId,
      duplicate: emptyDuplicate,
    });
  }

  function hydrateItem(item: BatchItem, draft: OcrDraft, duplicate: DuplicateAssessment): BatchItem {
    if (item.hydrated) return { ...item, status: item.status === "POSTED" ? "POSTED" : "DONE", duplicate };
    const normalizedTaxId = normalizeTaxIdentity(draft.supplierTaxId, draft.supplierCountryCode ?? "ES");
    const matched = normalizedTaxId
      ? suppliers.find((supplier) => normalizeTaxIdentity(supplier.taxId, draft.supplierCountryCode ?? "ES") === normalizedTaxId)
      : undefined;
    return {
      ...item,
      status: "DONE",
      draft,
      hydrated: true,
      supplierPartnerId: matched?.id ?? "",
      supplierName: matched ? "" : draft.supplierName ?? "",
      supplierTaxId: matched ? "" : draft.supplierTaxId ?? "",
      supplierCountryCode: draft.supplierCountryCode ?? "ES",
      supplierDocumentNumber: draft.supplierDocumentNumber ?? "",
      issueDate: draft.issueDate?.slice(0, 10) ?? today(),
      dueDate: draft.dueDate?.slice(0, 10) ?? "",
      currencyCode: (draft.currencyCode ?? "EUR").slice(0, 3).toUpperCase(),
      lines: draft.lines.map((line) => ({
        id: crypto.randomUUID(),
        description: line.description,
        expenseAccountId: expenseAccounts.find((account) => account.code === line.suggestedExpenseAccountCode)?.id ?? expenseAccounts[0]?.id ?? "",
        quantity: decimalDraft(line.quantity),
        unitPrice: decimalDraft(line.unitPrice),
        taxRate: decimalDraft(line.taxRate),
        taxDeductiblePct: decimalDraft(line.taxDeductiblePct),
        retentionRate: decimalDraft(line.retentionRate),
      })),
      duplicate,
    };
  }

  async function pollBatch(id: string, generation: number) {
    for (let attempt = 0; attempt < 120 && pollingGeneration.current === generation; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 4 ? 900 : 1800));
      const response = await fetch(`/api/expenses/ocr/batches/${id}`, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json() as { jobs: Array<{ id: string; status: string; errorMessage?: string; extracted?: OcrDraft; duplicateAssessment: DuplicateAssessment; supplierInvoiceId?: string }> };
      setItems((current) => current.map((item) => {
        const job = payload.jobs.find((candidate) => candidate.id === item.jobId);
        if (!job || item.status === "POSTED" || item.status === "POSTING") return item;
        if (job.supplierInvoiceId) return { ...item, status: "POSTED", createdExpenseId: job.supplierInvoiceId };
        if (job.status === "FAILED") return { ...item, status: "FAILED", error: job.errorMessage ?? "No se pudo analizar el archivo." };
        if (job.status === "DONE" && job.extracted) return hydrateItem(item, job.extracted, job.duplicateAssessment);
        return { ...item, status: job.status === "PROCESSING" ? "PROCESSING" : "PENDING" };
      }));
      if (payload.jobs.length > 0 && payload.jobs.every((job) => job.status === "DONE" || job.status === "FAILED" || Boolean(job.supplierInvoiceId))) return;
    }
  }

  async function uploadOne(item: BatchItem, id: string) {
    patchItem(item.localId, { status: "UPLOADING" });
    const formData = new FormData();
    formData.set("file", item.file);
    formData.set("batchId", id);
    const endpoint = engine === "openai" ? "/api/expenses/ai-analysis" : "/api/expenses/ocr";
    const response = await fetch(endpoint, { method: "POST", headers: getCsrfHeader(), body: formData });
    if (!response.ok) throw new Error(await readApiError(response, `No se pudo subir ${item.file.name}.`));
    const payload = await response.json().catch(() => ({})) as { id?: string; jobId?: string; status?: string; message?: string; draft?: OcrDraft };
    const jobId = payload.id ?? payload.jobId;
    if (!jobId) throw new Error(`No se pudo subir ${item.file.name}: el servidor no devolvió el análisis.`);
    patchItem(item.localId, { jobId, status: payload.draft ? "DONE" : "PENDING", draft: payload.draft });
  }

  async function startBatch(files: File[]) {
    if (files.length === 0) return;
    if (files.length > 50) return toast.error("Selecciona como máximo 50 archivos por lote.");
    const invalid = files.find((file) => file.size > 12 * 1024 * 1024);
    if (invalid) return toast.error(`${invalid.name} supera el límite de 12 MB.`);
    if (files.reduce((total, file) => total + file.size, 0) > 120 * 1024 * 1024) return toast.error("El lote supera el límite total de 120 MB.");

    setIsStarting(true);
    pollingGeneration.current += 1;
    const generation = pollingGeneration.current;
    const initialItems: BatchItem[] = files.map((file) => ({
      localId: crypto.randomUUID(), file, status: "WAITING", hydrated: false,
      supplierPartnerId: "", purchaseOrderId: "", goodsReceiptId: "", supplierName: "", supplierTaxId: "", supplierCountryCode: "ES",
      supplierDocumentNumber: "", issueDate: today(), dueDate: "", currencyCode: "EUR", lines: [],
      duplicate: emptyDuplicate, acknowledgePossible: false,
      acknowledgeBlocking: false,
    }));
    setItems(initialItems);
    try {
      const response = await fetch("/api/expenses/ocr/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ expectedFiles: files.length }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo crear el lote de facturas."));
      const batch = await response.json().catch(() => ({})) as { id?: string };
      if (!batch.id) throw new Error("No se pudo crear el lote de facturas. Inténtalo de nuevo.");
      setBatchId(batch.id);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(3, initialItems.length) }, async () => {
        while (cursor < initialItems.length) {
          const item = initialItems[cursor++];
          try {
            await uploadOne(item, batch.id as string);
          } catch (error) {
            patchItem(item.localId, { status: "FAILED", error: errorMessage(error, `No se pudo subir ${item.file.name}.`) });
          }
        }
      });
      await Promise.all(workers);
      toast.success(`${files.length === 1 ? "Archivo subido" : `${files.length} archivos subidos`}; el análisis continúa en segundo plano.`);
      void pollBatch(batch.id, generation);
    } catch (error) {
      const message = errorMessage(error, "No se pudo iniciar el lote.");
      setItems((current) => current.map((item) => ({ ...item, status: "FAILED", error: message })));
      toast.error(message);
    } finally {
      setIsStarting(false);
    }
  }

  async function checkDuplicate(item: BatchItem) {
    const totalAmount = item.lines.reduce((total, line) => total + lineTotal(line), 0);
    const response = await fetch("/api/expenses/duplicate-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getCsrfHeader() },
      body: JSON.stringify({
        supplierPartnerId: item.supplierPartnerId || undefined,
        supplierTaxId: item.supplierPartnerId ? undefined : item.supplierTaxId,
        supplierName: item.supplierPartnerId ? undefined : item.supplierName,
        supplierCountryCode: item.supplierCountryCode,
        supplierDocumentNumber: item.supplierDocumentNumber,
        issueDate: isoDate(item.issueDate),
        totalAmount,
        ocrJobId: item.jobId,
      }),
    });
    if (!response.ok) throw new Error("No se pudo comprobar si la factura está duplicada.");
    return response.json() as Promise<DuplicateAssessment>;
  }

  async function postItem(item: BatchItem) {
    if (!item.jobId || item.status !== "DONE") return;
    if (!item.supplierPartnerId && !item.supplierName.trim() && !item.supplierTaxId.trim()) return patchItem(item.localId, { error: "Indica o selecciona un proveedor." });
    if (!item.supplierDocumentNumber.trim()) return patchItem(item.localId, { error: "Revisa e indica el número de factura." });
    if (item.currencyCode !== baseCurrencyCode) return patchItem(item.localId, { error: `La factura está en ${item.currencyCode}. Configura su conversión a ${baseCurrencyCode} antes de contabilizarla.` });
    if (item.lines.length === 0) return patchItem(item.localId, { error: "El análisis no contiene líneas de gasto." });
    if (item.draft?.warnings.some((warning) => warning.toLocaleLowerCase().startsWith("bloqueo:")) && !item.acknowledgeBlocking) return patchItem(item.localId, { error: "Revisa los errores bloqueantes y confirma la corrección antes de contabilizar." });
    for (const line of item.lines) {
      const percentages = [parsePercent(line.taxRate), parsePercent(line.taxDeductiblePct), parsePercent(line.retentionRate)];
      if (!line.description.trim() || !line.expenseAccountId) return patchItem(item.localId, { error: "Todas las líneas necesitan concepto y cuenta de gasto." });
      if (!Number.isFinite(parseQuantity(line.quantity)) || parseQuantity(line.quantity) <= 0) return patchItem(item.localId, { error: "La cantidad de cada línea debe ser mayor que cero." });
      if (!Number.isFinite(parseMoney(line.unitPrice)) || parseMoney(line.unitPrice) < 0) return patchItem(item.localId, { error: "La base de cada línea debe ser válida y no negativa (por ejemplo, 100,00)." });
      if (percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) return patchItem(item.localId, { error: "IVA, deducibilidad y retención deben estar entre 0 y 100." });
    }
    const calculatedTotal = item.lines.reduce((total, line) => total + lineTotal(line), 0);
    if (item.draft?.totalAmount !== undefined && Math.abs(calculatedTotal - item.draft.totalAmount) > 0.03) {
      return patchItem(item.localId, { error: `Las líneas (${formatMoney(calculatedTotal, item.currencyCode)}) no cuadran con el total extraído (${formatMoney(item.draft.totalAmount, item.currencyCode)}).` });
    }
    try {
      const duplicate = await checkDuplicate(item);
      patchItem(item.localId, { duplicate });
      if (duplicate.level === "exact") throw new Error("Documento duplicado: revisa la factura existente antes de continuar.");
      if (duplicate.level === "possible" && !item.acknowledgePossible) throw new Error("Confirma la coincidencia por fecha e importe antes de contabilizar.");
      patchItem(item.localId, { status: "POSTING", error: undefined });
      const lines = item.lines.map((line) => ({
        expenseAccountId: line.expenseAccountId,
        description: line.description.trim(),
        quantity: parseQuantity(line.quantity), unitPrice: parseMoney(line.unitPrice), taxRate: parsePercent(line.taxRate),
        taxDeductiblePct: parsePercent(line.taxDeductiblePct), retentionRate: parsePercent(line.retentionRate),
      }));
      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          supplierPartnerId: item.supplierPartnerId || undefined,
          supplierName: item.supplierPartnerId ? undefined : item.supplierName,
          supplierTaxId: item.supplierPartnerId ? undefined : item.supplierTaxId,
          supplierCountryCode: item.supplierCountryCode,
          supplierDocumentNumber: item.supplierDocumentNumber,
          purchaseOrderId: item.purchaseOrderId || undefined,
          goodsReceiptId: item.goodsReceiptId || undefined,
          issueDate: isoDate(item.issueDate), dueDate: item.dueDate ? isoDate(item.dueDate) : undefined,
          currencyCode: item.currencyCode, ocrJobId: item.jobId,
          idempotencyKey: `expense-ocr-job:${item.jobId}`, lines,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo contabilizar la factura."));
      const payload = await response.json().catch(() => ({})) as { id?: string };
      if (!payload.id) throw new Error("No se pudo contabilizar la factura: el servidor no devolvió su identificador.");
      patchItem(item.localId, { status: "POSTED", createdExpenseId: payload.id, error: undefined });
      toast.success(`${item.file.name} se ha registrado y contabilizado.`);
    } catch (error) {
      const message = errorMessage(error, "No se pudo contabilizar la factura.");
      patchItem(item.localId, { status: "DONE", error: message });
      toast.error(`${item.file.name}: ${message}`);
    }
  }

  function submitItem(event: React.FormEvent<HTMLFormElement>, item: BatchItem) {
    event.preventDefault();
    if (item.status !== "DONE") return;
    void postItem(item);
  }

  async function postReady() {
    const ready = items.filter((item) => item.status === "DONE" && item.draft?.confidence === "high" && item.duplicate.level === "none" && !item.draft.warnings.some((warning) => warning.toLocaleLowerCase().startsWith("bloqueo:")));
    for (const item of ready) await postItem(item);
  }

  async function retryItem(item: BatchItem) {
    if (!item.jobId || !batchId) return;
    patchItem(item.localId, { status: "PENDING", error: undefined });
    const response = await fetch(`/api/expenses/ocr/${item.jobId}`, { method: "POST", headers: getCsrfHeader() });
    if (!response.ok) {
      const message = await readApiError(response, "No se pudo reintentar el análisis.");
      toast.error(message);
      return patchItem(item.localId, { status: "FAILED", error: message });
    }
    toast.success(`Reanalizando ${item.file.name}…`);
    pollingGeneration.current += 1;
    void pollBatch(batchId, pollingGeneration.current);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-window-shadow pb-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Button className="mb-2" onClick={onBack} size="sm" type="button" variant="ghost">
            <ArrowLeft aria-hidden="true" /> Cambiar modo
          </Button>
          <h2 className="font-mono text-base font-bold">Bandeja de facturas</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">Cada archivo se analiza y contabiliza por separado. Un error no detiene los demás documentos.</p>
        </div>
        {items.length > 0 ? <Button disabled={!items.some((item) => item.status === "DONE" && item.draft?.confidence === "high" && item.duplicate.level === "none" && !item.draft.warnings.some((warning) => warning.toLocaleLowerCase().startsWith("bloqueo:")))} onClick={() => void postReady()} type="button">Registrar preparados</Button> : null}
      </header>

      <section aria-label="Subir facturas" className="grid gap-3 border border-window-dark-shadow bg-window-panel p-3 shadow-[inset_1px_1px_0_var(--window-highlight)] lg:grid-cols-[220px_1fr] lg:items-end">
        <AccessibleField helperText={items.length > 0 ? "Se elige antes de subir el lote." : "El OCR local no envía datos fuera del ERP."} id="expense-batch-engine" label="Motor de análisis">
          <Select disabled={items.length > 0} id="expense-batch-engine" onChange={(event) => setEngine(event.target.value as "local" | "openai")} value={engine}>
            <option value="local">OCR local</option>
            <option value="openai">OpenAI</option>
          </Select>
        </AccessibleField>
        <label
          className={cn(
            "group flex min-h-24 cursor-pointer items-center justify-center gap-3 border border-dashed border-window-dark-shadow bg-card px-5 text-center transition-colors hover:bg-window-highlight has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
            isStarting && "cursor-wait opacity-60",
          )}
          htmlFor="expense-batch-files"
        >
          <UploadSimple className="size-6 text-primary" aria-hidden="true" />
          <span>
            <span className="block font-mono text-sm font-bold">{isStarting ? "Subiendo…" : "Seleccionar facturas"}</span>
            <span className="block text-xs text-muted-foreground" id="expense-batch-files-helper">PDF, PNG, JPG o WEBP · hasta 50 archivos de 12 MB</span>
          </span>
          <input accept="application/pdf,image/png,image/jpeg,image/webp" aria-describedby="expense-batch-files-helper" className="sr-only" disabled={isStarting} id="expense-batch-files" multiple onChange={(event) => void startBatch(Array.from(event.target.files ?? []))} type="file" />
        </label>
      </section>

      {items.length > 0 ? (
        <dl className="grid grid-cols-2 gap-px border border-window-dark-shadow bg-window-shadow md:grid-cols-5">
          {[['Archivos', counts.total], ['Procesando', counts.processing], ['Por revisar', counts.review], ['Registrados', counts.posted], ['Con error', counts.failed]].map(([label, value]) => (
            <div className="bg-card px-3 py-2" key={String(label)}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-mono text-lg font-bold tabular-nums">{value}</dd></div>
          ))}
        </dl>
      ) : null}

      {items.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center border border-dashed border-window-dark-shadow bg-window-panel text-center">
          <FileText className="mb-2 size-7 text-muted-foreground" aria-hidden="true" />
          <p className="font-mono text-sm font-bold">Aún no hay documentos</p>
          <p className="mt-1 text-xs text-muted-foreground">Pulsa Seleccionar facturas para subir uno o varios archivos y crear la cola de revisión.</p>
        </div>
      ) : (
        <div className="space-y-3" aria-live="polite">
          {items.map((item, index) => {
            const total = item.lines.reduce((sum, line) => sum + lineTotal(line), 0);
            const totalsMismatch = item.draft?.totalAmount !== undefined && Math.abs(total - item.draft.totalAmount) > 0.03;
            return (
              <article aria-labelledby={`batch-item-${item.localId}-title`} className="border border-window-dark-shadow bg-card shadow-[inset_1px_1px_0_var(--window-highlight)]" key={item.localId}>
                <div className="flex flex-col gap-3 border-b border-window-shadow bg-window-panel px-3 py-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    {item.status === "POSTED" ? <CheckCircle aria-hidden="true" className="size-5 shrink-0 text-success" weight="fill" /> : item.status === "FAILED" ? <XCircle aria-hidden="true" className="size-5 shrink-0 text-destructive" weight="fill" /> : ["WAITING", "UPLOADING", "PENDING", "PROCESSING", "POSTING"].includes(item.status) ? <SpinnerGap aria-hidden="true" className="size-5 shrink-0 animate-spin text-primary" /> : <FileText aria-hidden="true" className="size-5 shrink-0 text-primary" />}
                    <div className="min-w-0"><p className="truncate font-mono text-xs font-bold" id={`batch-item-${item.localId}-title`}>{index + 1}. {item.file.name}</p><p className="text-xs text-muted-foreground">{statusLabel(item.status)} · {formatAmount(item.file.size / 1024 / 1024)} MB{item.draft ? ` · confianza ${confidenceLabels[item.draft.confidence]}` : ""}</p></div>
                  </div>
                  {item.createdExpenseId ? <a className="font-mono text-xs font-bold text-primary hover:underline" href={`/expenses/${item.createdExpenseId}`}>Abrir factura</a> : null}
                </div>

                {item.status === "DONE" || item.status === "POSTING" || item.status === "POSTED" ? (
                  <form className="space-y-3 p-3" noValidate onSubmit={(event) => submitItem(event, item)}>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                      <AccessibleField className="xl:col-span-2" id={`supplier-${item.localId}`} label="Proveedor">
                        <Select disabled={item.status !== "DONE"} id={`supplier-${item.localId}`} onChange={(event) => selectItemSupplier(item, event.target.value)} value={item.supplierPartnerId}><option value="">Nuevo / no encontrado</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.number} · {supplier.name} · {supplier.taxId ?? "sin NIF"}</option>)}</Select>
                      </AccessibleField>
                      {!item.supplierPartnerId ? (
                        <>
                          <AccessibleField helperText="Nombre o CIF: al menos uno." id={`supplier-name-${item.localId}`} label="Razón social">
                            <Input disabled={item.status !== "DONE"} id={`supplier-name-${item.localId}`} onChange={(event) => patchItem(item.localId, { supplierName: event.target.value })} value={item.supplierName} />
                          </AccessibleField>
                          <AccessibleField id={`supplier-tax-${item.localId}`} label="CIF/NIF/VAT">
                            <Input disabled={item.status !== "DONE"} id={`supplier-tax-${item.localId}`} onChange={(event) => patchItem(item.localId, { supplierTaxId: event.target.value, duplicate: emptyDuplicate })} value={item.supplierTaxId} />
                          </AccessibleField>
                        </>
                      ) : null}
                      <AccessibleField id={`number-${item.localId}`} label="N.º factura" required>
                        <Input disabled={item.status !== "DONE"} id={`number-${item.localId}`} onChange={(event) => patchItem(item.localId, { supplierDocumentNumber: event.target.value, duplicate: emptyDuplicate })} value={item.supplierDocumentNumber} />
                      </AccessibleField>
                      <AccessibleField id={`date-${item.localId}`} label="Fecha" required>
                        <Input disabled={item.status !== "DONE"} id={`date-${item.localId}`} onChange={(event) => patchItem(item.localId, { issueDate: event.target.value, duplicate: emptyDuplicate })} type="date" value={item.issueDate} />
                      </AccessibleField>
                      <AccessibleField id={`due-date-${item.localId}`} label="Vencimiento">
                        <Input disabled={item.status !== "DONE"} id={`due-date-${item.localId}`} onChange={(event) => patchItem(item.localId, { dueDate: event.target.value })} type="date" value={item.dueDate} />
                      </AccessibleField>
                      <AccessibleField helperText={item.currencyCode !== baseCurrencyCode ? `Requiere conversión a ${baseCurrencyCode}` : undefined} id={`currency-${item.localId}`} label="Moneda" required>
                        <Input disabled={item.status !== "DONE"} id={`currency-${item.localId}`} maxLength={3} onChange={(event) => patchItem(item.localId, { currencyCode: event.target.value.toUpperCase() })} value={item.currencyCode} />
                      </AccessibleField>
                    </div>

                    <div className="grid gap-3 border border-window-shadow bg-window-panel p-2.5 md:grid-cols-2">
                      <AccessibleField id={`purchase-order-${item.localId}`} label="Pedido de compra (opcional)">
                        <Select disabled={item.status !== "DONE"} id={`purchase-order-${item.localId}`} onChange={(event) => selectItemPurchaseOrder(item, event.target.value)} value={item.purchaseOrderId}>
                          <option value="">Sin pedido relacionado</option>
                          {purchaseOrders.filter((order) => !item.supplierPartnerId || order.supplierPartnerId === item.supplierPartnerId).map((order) => <option key={order.id} value={order.id}>{order.number}</option>)}
                        </Select>
                      </AccessibleField>
                      <AccessibleField id={`goods-receipt-${item.localId}`} label="Recepción (opcional)">
                        <Select disabled={item.status !== "DONE"} id={`goods-receipt-${item.localId}`} onChange={(event) => selectItemGoodsReceipt(item, event.target.value)} value={item.goodsReceiptId}>
                          <option value="">Sin recepción relacionada</option>
                          {goodsReceipts.filter((receipt) => item.purchaseOrderId ? receipt.purchaseOrderId === item.purchaseOrderId : !item.supplierPartnerId || receipt.supplierPartnerId === item.supplierPartnerId).map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.number}</option>)}
                        </Select>
                      </AccessibleField>
                    </div>

                    <details className="border border-window-shadow" open={item.lines.length <= 2}>
                      <summary className="cursor-pointer px-3 py-2 font-mono text-xs font-bold">{item.lines.length} línea{item.lines.length === 1 ? "" : "s"} · {formatMoney(total, item.currencyCode)}</summary>
                      <div className="space-y-3 border-t border-window-shadow p-3">
                        {item.lines.map((line, lineIndex) => (
                          <fieldset className="grid gap-2 lg:grid-cols-[2fr_1.5fr_repeat(5,minmax(76px,0.55fr))]" key={line.id}>
                            <legend className="sr-only">Línea {lineIndex + 1}</legend>
                            <AccessibleField hideLabel={lineIndex > 0} id={`line-description-${line.id}`} label={lineIndex > 0 ? `Concepto línea ${lineIndex + 1}` : "Concepto"}>
                              <Input disabled={item.status !== "DONE"} id={`line-description-${line.id}`} onChange={(event) => patchLine(item.localId, line.id, { description: event.target.value })} value={line.description} />
                            </AccessibleField>
                            <AccessibleField hideLabel={lineIndex > 0} id={`line-account-${line.id}`} label={lineIndex > 0 ? `Cuenta línea ${lineIndex + 1}` : "Cuenta"}>
                              <Select disabled={item.status !== "DONE"} id={`line-account-${line.id}`} onChange={(event) => patchLine(item.localId, line.id, { expenseAccountId: event.target.value })} value={line.expenseAccountId}>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</Select>
                            </AccessibleField>
                            {lineNumberFields.map(({ field, kind, label }) => {
                              const inputProps = {
                                disabled: item.status !== "DONE",
                                id: `${field}-${line.id}`,
                                onChange: (event: React.ChangeEvent<HTMLInputElement>) => patchLine(item.localId, line.id, { [field]: event.target.value } as Partial<DraftLine>),
                                value: line[field],
                              };
                              return (
                                <AccessibleField hideLabel={lineIndex > 0} id={`${field}-${line.id}`} key={field} label={lineIndex > 0 ? `${label} línea ${lineIndex + 1}` : label}>
                                  {kind === "quantity" ? <QuantityInput {...inputProps} /> : kind === "money" ? <MoneyInput currencySymbol={item.currencyCode === "EUR" ? "€" : item.currencyCode} {...inputProps} /> : <PercentInput {...inputProps} />}
                                </AccessibleField>
                              );
                            })}
                          </fieldset>
                        ))}
                      </div>
                    </details>

                    {item.draft?.warnings.length ? <div className="text-xs text-warning"><p className="flex items-start gap-2"><WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" />{item.draft.warnings.join(" ")}</p>{item.draft.warnings.some((warning) => warning.toLocaleLowerCase().startsWith("bloqueo:")) ? <label className="mt-2 flex items-center gap-2 pl-6 font-mono font-bold" htmlFor={`ack-blocking-${item.localId}`}><input checked={item.acknowledgeBlocking} id={`ack-blocking-${item.localId}`} onChange={(event) => patchItem(item.localId, { acknowledgeBlocking: event.target.checked })} type="checkbox" />He corregido y revisado los datos bloqueantes</label> : null}</div> : null}
                    {totalsMismatch ? <p className="font-mono text-xs text-destructive">Las líneas suman {formatMoney(total, item.currencyCode)} y el documento indica {formatMoney(item.draft?.totalAmount ?? 0, item.currencyCode)}. Corrige las líneas para poder registrar.</p> : null}
                    {item.duplicate.level !== "none" ? <div className={cn("border px-3 py-2 text-xs", item.duplicate.level === "exact" ? "border-destructive bg-destructive/10 text-destructive" : "border-warning bg-warning/10 text-warning")} role="status"><p className="font-mono font-bold">{item.duplicate.level === "exact" ? "Duplicado exacto" : "Coincidencia por fecha e importe"}</p>{item.duplicate.matches.map((match) => <a className="mt-1 block underline" href={`/expenses/${match.invoiceId}`} key={match.invoiceId}>Revisar {match.number}</a>)}{item.duplicate.level === "possible" ? <label className="mt-2 flex items-center gap-2 font-mono font-bold" htmlFor={`ack-possible-${item.localId}`}><input checked={item.acknowledgePossible} id={`ack-possible-${item.localId}`} onChange={(event) => patchItem(item.localId, { acknowledgePossible: event.target.checked })} type="checkbox" />Confirmo que es una factura distinta</label> : null}</div> : null}
                    <FormErrorMessage>{item.error}</FormErrorMessage>
                    {item.status !== "POSTED" ? <div className="flex justify-end"><SubmitButton disabled={item.duplicate.level === "exact" || totalsMismatch} pending={item.status === "POSTING"} pendingLabel="Registrando…">Registrar factura</SubmitButton></div> : null}
                  </form>
                ) : item.error ? <div className="flex items-center justify-between gap-3 p-3"><FormErrorMessage>{item.error}</FormErrorMessage>{item.jobId ? <Button onClick={() => void retryItem(item)} type="button" variant="outline">Reintentar</Button> : null}</div> : null}
              </article>
            );
          })}
        </div>
      )}
      {batchId ? <p className="text-right font-mono text-xs text-muted-foreground">Lote {batchId.slice(0, 8)}</p> : null}
    </div>
  );
}
