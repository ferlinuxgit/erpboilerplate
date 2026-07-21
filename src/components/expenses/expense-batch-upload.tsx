"use client";

import { ArrowLeft, CheckCircle, FileText, SpinnerGap, UploadSimple, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { normalizeTaxIdentity } from "@/lib/expense-dedup";
import { formatMoney } from "@/lib/format";

type ExpenseAccount = { id: string; code: string; name: string };
type Supplier = { id: string; number: string; name: string; taxId: string | null };
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
  suppliers: Supplier[];
  onBack: () => void;
};

const emptyDuplicate: DuplicateAssessment = { level: "none", matches: [] };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

function lineTotal(line: DraftLine) {
  const subtotal = Number(line.quantity) * Number(line.unitPrice);
  const tax = subtotal * Number(line.taxRate) / 100;
  const retention = subtotal * Number(line.retentionRate) / 100;
  return Number.isFinite(subtotal + tax - retention) ? subtotal + tax - retention : 0;
}

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

export function ExpenseBatchUpload({ baseCurrencyCode, expenseAccounts, suppliers, onBack }: Props) {
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
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
        taxRate: String(line.taxRate),
        taxDeductiblePct: String(line.taxDeductiblePct),
        retentionRate: String(line.retentionRate),
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
    const payload = await response.json() as { id?: string; jobId?: string; status?: string; message?: string; draft?: OcrDraft };
    const jobId = payload.id ?? payload.jobId;
    if (!response.ok || !jobId) throw new Error(payload.message ?? "No se pudo subir el archivo.");
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
      supplierPartnerId: "", supplierName: "", supplierTaxId: "", supplierCountryCode: "ES",
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
      const batch = await response.json() as { id?: string; message?: string };
      if (!response.ok || !batch.id) throw new Error(batch.message ?? "No se pudo crear el lote.");
      setBatchId(batch.id);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(3, initialItems.length) }, async () => {
        while (cursor < initialItems.length) {
          const item = initialItems[cursor++];
          try {
            await uploadOne(item, batch.id as string);
          } catch (error) {
            patchItem(item.localId, { status: "FAILED", error: error instanceof Error ? error.message : "Error de carga." });
          }
        }
      });
      await Promise.all(workers);
      void pollBatch(batch.id, generation);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo iniciar el lote.";
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
    if (!response.ok) throw new Error("No se pudo comprobar si el gasto está duplicado.");
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
      const percentages = [Number(line.taxRate), Number(line.taxDeductiblePct), Number(line.retentionRate)];
      if (!line.description.trim() || !line.expenseAccountId) return patchItem(item.localId, { error: "Todas las líneas necesitan concepto y cuenta de gasto." });
      if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) return patchItem(item.localId, { error: "La cantidad de cada línea debe ser mayor que cero." });
      if (!Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) return patchItem(item.localId, { error: "La base de cada línea debe ser válida y no negativa." });
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
        quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), taxRate: Number(line.taxRate),
        taxDeductiblePct: Number(line.taxDeductiblePct), retentionRate: Number(line.retentionRate),
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
          issueDate: isoDate(item.issueDate), dueDate: item.dueDate ? isoDate(item.dueDate) : undefined,
          currencyCode: item.currencyCode, ocrJobId: item.jobId,
          idempotencyKey: `expense-ocr-job:${item.jobId}`, lines,
        }),
      });
      const payload = await response.json() as { id?: string; message?: string };
      if (!response.ok || !payload.id) throw new Error(payload.message ?? "No se pudo contabilizar el gasto.");
      patchItem(item.localId, { status: "POSTED", createdExpenseId: payload.id, error: undefined });
      toast.success(`${item.file.name} se ha contabilizado.`);
    } catch (error) {
      patchItem(item.localId, { status: "DONE", error: error instanceof Error ? error.message : "No se pudo contabilizar." });
    }
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
      const payload = await response.json() as { message?: string };
      return patchItem(item.localId, { status: "FAILED", error: payload.message ?? "No se pudo reintentar." });
    }
    pollingGeneration.current += 1;
    void pollBatch(batchId, pollingGeneration.current);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <button className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground" onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" /> Cambiar modo
          </button>
          <h2 className="text-xl font-semibold tracking-tight">Bandeja de facturas</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Cada archivo se analiza y contabiliza por separado. Un error no detiene los demás documentos.</p>
        </div>
        {items.length > 0 ? <Button disabled={!items.some((item) => item.status === "DONE" && item.draft?.confidence === "high" && item.duplicate.level === "none" && !item.draft.warnings.some((warning) => warning.toLocaleLowerCase().startsWith("bloqueo:")))} onClick={() => void postReady()} type="button">Registrar preparados</Button> : null}
      </header>

      <section className="grid gap-3 rounded-md bg-muted/30 p-4 lg:grid-cols-[220px_1fr] lg:items-end">
        <div className="space-y-2">
          <Label htmlFor="expense-batch-engine">Motor de análisis</Label>
          <Select disabled={items.length > 0} id="expense-batch-engine" onChange={(event) => setEngine(event.target.value as "local" | "openai")} value={engine}>
            <option value="local">OCR local</option>
            <option value="openai">OpenAI</option>
          </Select>
        </div>
        <label className="group flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-md border border-dashed bg-background px-5 text-center transition-colors hover:border-primary/60 hover:bg-primary/5">
          <UploadSimple className="h-6 w-6 text-primary transition-transform group-hover:-translate-y-0.5" aria-hidden="true" />
          <span><span className="block text-sm font-medium">Seleccionar facturas</span><span className="block text-xs text-muted-foreground">PDF, PNG, JPG o WEBP · hasta 50 archivos</span></span>
          <input accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" disabled={isStarting} multiple onChange={(event) => void startBatch(Array.from(event.target.files ?? []))} type="file" />
        </label>
      </section>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-5">
          {[['Archivos', counts.total], ['Procesando', counts.processing], ['Por revisar', counts.review], ['Registrados', counts.posted], ['Con error', counts.failed]].map(([label, value]) => (
            <div className="bg-background px-4 py-3" key={String(label)}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p></div>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed text-center">
          <FileText className="mb-3 h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Aún no hay documentos</p>
          <p className="mt-1 text-sm text-muted-foreground">Selecciona varias facturas para crear la cola de revisión.</p>
        </div>
      ) : (
        <div className="space-y-3" aria-live="polite">
          {items.map((item, index) => {
            const total = item.lines.reduce((sum, line) => sum + lineTotal(line), 0);
            const totalsMismatch = item.draft?.totalAmount !== undefined && Math.abs(total - item.draft.totalAmount) > 0.03;
            return (
              <article className="overflow-hidden rounded-md border bg-background" key={item.localId}>
                <div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    {item.status === "POSTED" ? <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" weight="fill" /> : item.status === "FAILED" ? <XCircle className="h-5 w-5 shrink-0 text-red-600" weight="fill" /> : ["WAITING", "UPLOADING", "PENDING", "PROCESSING", "POSTING"].includes(item.status) ? <SpinnerGap className="h-5 w-5 shrink-0 animate-spin text-primary" /> : <FileText className="h-5 w-5 shrink-0 text-primary" />}
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{index + 1}. {item.file.name}</p><p className="text-xs text-muted-foreground">{statusLabel(item.status)} · {(item.file.size / 1024 / 1024).toFixed(2)} MB{item.draft ? ` · confianza ${item.draft.confidence}` : ""}</p></div>
                  </div>
                  {item.createdExpenseId ? <a className="text-sm font-medium text-primary hover:underline" href={`/expenses/${item.createdExpenseId}`}>Abrir gasto</a> : null}
                </div>

                {item.status === "DONE" || item.status === "POSTING" || item.status === "POSTED" ? (
                  <div className="space-y-4 p-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                      <div className="space-y-2 xl:col-span-2"><Label htmlFor={`supplier-${item.localId}`}>Proveedor</Label><Select disabled={item.status !== "DONE"} id={`supplier-${item.localId}`} onChange={(event) => patchItem(item.localId, { supplierPartnerId: event.target.value, duplicate: emptyDuplicate })} value={item.supplierPartnerId}><option value="">Nuevo / no encontrado</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.number} · {supplier.name} · {supplier.taxId ?? "sin NIF"}</option>)}</Select></div>
                      {!item.supplierPartnerId ? <><div className="space-y-2"><Label htmlFor={`supplier-name-${item.localId}`}>Razón social</Label><Input disabled={item.status !== "DONE"} id={`supplier-name-${item.localId}`} onChange={(event) => patchItem(item.localId, { supplierName: event.target.value })} value={item.supplierName} /></div><div className="space-y-2"><Label htmlFor={`supplier-tax-${item.localId}`}>CIF/NIF/VAT</Label><Input disabled={item.status !== "DONE"} id={`supplier-tax-${item.localId}`} onChange={(event) => patchItem(item.localId, { supplierTaxId: event.target.value, duplicate: emptyDuplicate })} value={item.supplierTaxId} /></div></> : null}
                      <div className="space-y-2"><Label htmlFor={`number-${item.localId}`}>N.º factura</Label><Input disabled={item.status !== "DONE"} id={`number-${item.localId}`} onChange={(event) => patchItem(item.localId, { supplierDocumentNumber: event.target.value, duplicate: emptyDuplicate })} value={item.supplierDocumentNumber} /></div>
                      <div className="space-y-2"><Label htmlFor={`date-${item.localId}`}>Fecha</Label><Input disabled={item.status !== "DONE"} id={`date-${item.localId}`} onChange={(event) => patchItem(item.localId, { issueDate: event.target.value, duplicate: emptyDuplicate })} type="date" value={item.issueDate} /></div>
                      <div className="space-y-2"><Label htmlFor={`due-date-${item.localId}`}>Vencimiento</Label><Input disabled={item.status !== "DONE"} id={`due-date-${item.localId}`} onChange={(event) => patchItem(item.localId, { dueDate: event.target.value })} type="date" value={item.dueDate} /></div>
                      <div className="space-y-2"><Label htmlFor={`currency-${item.localId}`}>Moneda</Label><Input disabled={item.status !== "DONE"} id={`currency-${item.localId}`} maxLength={3} onChange={(event) => patchItem(item.localId, { currencyCode: event.target.value.toUpperCase() })} value={item.currencyCode} />{item.currencyCode !== baseCurrencyCode ? <p className="text-xs text-amber-700">Requiere conversión a {baseCurrencyCode}</p> : null}</div>
                    </div>

                    <details className="rounded-md border" open={item.lines.length <= 2}>
                      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{item.lines.length} línea{item.lines.length === 1 ? "" : "s"} · {formatMoney(total, item.currencyCode)}</summary>
                      <div className="space-y-3 border-t p-3">
                        {item.lines.map((line, lineIndex) => <div className="grid gap-2 lg:grid-cols-[2fr_1.5fr_repeat(5,minmax(76px,0.55fr))]" key={line.id}>
                          <div><Label className="sr-only" htmlFor={`line-description-${line.id}`}>Concepto</Label><Input disabled={item.status !== "DONE"} id={`line-description-${line.id}`} onChange={(event) => patchLine(item.localId, line.id, { description: event.target.value })} value={line.description} /></div>
                          <div><Label className="sr-only" htmlFor={`line-account-${line.id}`}>Cuenta</Label><Select disabled={item.status !== "DONE"} id={`line-account-${line.id}`} onChange={(event) => patchLine(item.localId, line.id, { expenseAccountId: event.target.value })} value={line.expenseAccountId}>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</Select></div>
                          {[['quantity', 'Cant.', line.quantity], ['unitPrice', 'Base', line.unitPrice], ['taxRate', 'IVA %', line.taxRate], ['taxDeductiblePct', 'Ded. %', line.taxDeductiblePct], ['retentionRate', 'Ret. %', line.retentionRate]].map(([field, label, value]) => <div key={field}><Label className="sr-only" htmlFor={`${field}-${line.id}`}>{label} línea {lineIndex + 1}</Label><Input disabled={item.status !== "DONE"} id={`${field}-${line.id}`} min="0" onChange={(event) => patchLine(item.localId, line.id, { [field]: event.target.value } as Partial<DraftLine>)} placeholder={label} step="0.01" type="number" value={value} /></div>)}
                        </div>)}
                      </div>
                    </details>

                    {item.draft?.warnings.length ? <div className="text-sm text-amber-700"><p className="flex items-start gap-2"><WarningCircle className="mt-0.5 shrink-0" />{item.draft.warnings.join(" ")}</p>{item.draft.warnings.some((warning) => warning.toLocaleLowerCase().startsWith("bloqueo:")) ? <label className="mt-2 flex items-center gap-2 pl-6"><input checked={item.acknowledgeBlocking} onChange={(event) => patchItem(item.localId, { acknowledgeBlocking: event.target.checked })} type="checkbox" />He corregido y revisado los datos bloqueantes</label> : null}</div> : null}
                    {totalsMismatch ? <p className="text-sm text-red-600">Las líneas suman {formatMoney(total, item.currencyCode)} y el documento indica {formatMoney(item.draft?.totalAmount ?? 0, item.currencyCode)}.</p> : null}
                    {item.duplicate.level !== "none" ? <div className={`rounded-md px-3 py-2 text-sm ${item.duplicate.level === "exact" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}><p className="font-medium">{item.duplicate.level === "exact" ? "Duplicado exacto" : "Coincidencia por fecha e importe"}</p>{item.duplicate.matches.map((match) => <a className="mt-1 block underline" href={`/expenses/${match.invoiceId}`} key={match.invoiceId}>Revisar {match.number}</a>)}{item.duplicate.level === "possible" ? <label className="mt-2 flex items-center gap-2"><input checked={item.acknowledgePossible} onChange={(event) => patchItem(item.localId, { acknowledgePossible: event.target.checked })} type="checkbox" />Confirmo que es un gasto distinto</label> : null}</div> : null}
                    {item.error ? <p className="text-sm text-red-600" role="alert">{item.error}</p> : null}
                    {item.status === "DONE" ? <div className="flex justify-end"><Button disabled={item.duplicate.level === "exact" || totalsMismatch} onClick={() => void postItem(item)} type="button">Registrar este gasto</Button></div> : null}
                  </div>
                ) : item.error ? <div className="flex items-center justify-between gap-3 p-4"><p className="text-sm text-red-600" role="alert">{item.error}</p>{item.jobId ? <Button onClick={() => void retryItem(item)} type="button" variant="outline">Reintentar</Button> : null}</div> : null}
              </article>
            );
          })}
        </div>
      )}
      {batchId ? <p className="text-right font-mono text-xs text-muted-foreground">Lote {batchId.slice(0, 8)}</p> : null}
    </div>
  );
}
