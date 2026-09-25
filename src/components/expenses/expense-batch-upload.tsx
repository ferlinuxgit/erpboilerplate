"use client";

import { ArrowLeft, Camera, CheckCircle, FileText, SpinnerGap, Trash, UploadSimple, WarningCircle, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AccountOption } from "@/lib/account-aliases";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatAmount, formatMoney, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ExpenseBatchItemReview, type GoodsReceiptRelation, type PurchaseOrderRelation } from "./expense-batch-item-review";
import {
  emptyDuplicate,
  itemFromInboxJob,
  mergeJobProgress,
  newBatchItem,
  PROCESSING_STATUSES,
  type BatchItem,
  type BatchSupplier,
  type DuplicateAssessment,
  type InboxJob,
} from "./expense-batch-model";
import { assessReadiness, reviewReasonLabels, selectSafeToPost, type ReviewItem } from "./expense-review";
import { useLeaveWarning } from "./use-leave-warning";

export type ExpenseAiSettings = { externalAiEnabled: boolean; externalAiConfigured: boolean };

type Props = {
  baseCurrencyCode: string;
  expenseAccounts: AccountOption[];
  goodsReceipts: GoodsReceiptRelation[];
  purchaseOrders: PurchaseOrderRelation[];
  suppliers: BatchSupplier[];
  /** Documentos pendientes guardados en el servidor (bandeja restaurada). */
  initialJobs?: InboxJob[];
  aiSettings: ExpenseAiSettings;
  canManageAiSettings?: boolean;
  onBack?: () => void;
  backHref?: string;
};

const MAX_FILES = 50;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_BATCH_BYTES = 120 * 1024 * 1024;
const POLL_STALL_MS = 4 * 60 * 1000;
const MAX_POLL_FAILURES = 5;
const ACCEPTED_TYPES = "application/pdf,image/png,image/jpeg,image/webp";

type PollState = "idle" | "polling" | "stalled";

function isoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

const parseQuantity = (raw: string) => parseDecimalInput(raw) ?? Number.NaN;
const parseMoney = (raw: string) => parseDecimalInput(raw, { maximumFractionDigits: 2 }) ?? Number.NaN;
const parsePercent = (raw: string) => parseDecimalInput(raw, { maximumFractionDigits: 2 }) ?? Number.NaN;

function statusLabel(status: BatchItem["status"]) {
  return {
    WAITING: "En cola",
    UPLOADING: "Subiendo",
    PENDING: "Pendiente de análisis",
    PROCESSING: "Analizando",
    DONE: "Por revisar",
    FAILED: "Error",
    POSTING: "Registrando",
    POSTED: "Registrada",
  }[status];
}

function toReviewItem(item: BatchItem): ReviewItem {
  return {
    status: item.status,
    confidence: item.draft?.confidence,
    warnings: item.draft?.warnings ?? [],
    // Una coincidencia por fecha e importe confirmada como factura distinta ya no bloquea.
    duplicateLevel: item.duplicate.level === "possible" && item.acknowledgePossible ? "none" : item.duplicate.level,
    acknowledgeBlocking: item.acknowledgeBlocking,
    reviewed: item.reviewed,
    supplierPartnerId: item.supplierPartnerId,
    supplierName: item.supplierName,
    supplierTaxId: item.supplierTaxId,
    supplierDocumentNumber: item.supplierDocumentNumber,
    issueDate: item.issueDate,
    currencyCode: item.currencyCode,
    extractedTotal: item.draft?.totalAmount,
    lines: item.lines,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type JobProgress = Pick<InboxJob, "status" | "errorMessage" | "extracted" | "duplicateAssessment" | "supplierInvoiceId" | "extractionProvider"> & { id: string };

export function ExpenseBatchUpload({
  aiSettings: initialAiSettings,
  backHref,
  baseCurrencyCode,
  canManageAiSettings = false,
  expenseAccounts,
  goodsReceipts,
  initialJobs = [],
  onBack,
  purchaseOrders,
  suppliers,
}: Props) {
  const context = useMemo(() => ({ expenseAccounts, suppliers }), [expenseAccounts, suppliers]);
  const [items, setItems] = useState<BatchItem[]>(() => initialJobs.map((job) => itemFromInboxJob(job, { expenseAccounts, suppliers })));
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState(initialAiSettings);
  const aiAvailable = aiSettings.externalAiEnabled && aiSettings.externalAiConfigured;
  const [engine, setEngine] = useState<"local" | "openai">("local");
  const effectiveEngine = aiAvailable ? engine : "local";
  const [isStarting, setIsStarting] = useState(false);
  const [pollState, setPollState] = useState<PollState>("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkPosting, setBulkPosting] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<BatchItem | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [shots, setShots] = useState<File[]>([]);
  const pollingGeneration = useRef(0);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const counts = useMemo(() => {
    const readiness = items.map((item) => (item.status === "DONE" ? assessReadiness(toReviewItem(item), baseCurrencyCode) : null));
    return {
      total: items.length,
      uploading: items.filter((item) => item.status === "WAITING" || item.status === "UPLOADING").length,
      processing: items.filter((item) => PROCESSING_STATUSES.includes(item.status)).length,
      review: items.filter((item) => item.status === "DONE").length,
      ready: readiness.filter((entry) => entry?.ready).length,
      posting: items.filter((item) => item.status === "POSTING").length,
      posted: items.filter((item) => item.status === "POSTED").length,
      failed: items.filter((item) => item.status === "FAILED").length,
    };
  }, [baseCurrencyCode, items]);
  const safeToPost = useMemo(() => selectSafeToPost(items.map((item) => ({ ...toReviewItem(item), source: item })), baseCurrencyCode), [baseCurrencyCode, items]);

  useLeaveWarning(
    counts.uploading > 0 || counts.posting > 0 || bulkPosting,
    "Hay facturas subiéndose o registrándose. Si sales ahora se interrumpirá el proceso.",
  );
  useLeaveWarning(
    counts.uploading === 0 && counts.posting === 0 && !bulkPosting && counts.processing > 0,
    "Hay documentos analizándose. Seguirán en el servidor y podrás revisarlos luego en «Bandeja pendiente». ¿Salir?",
  );

  function patchItem(localId: string, patch: Partial<BatchItem> | ((item: BatchItem) => BatchItem)) {
    setItems((current) => current.map((item) => (item.localId !== localId ? item : typeof patch === "function" ? patch(item) : { ...item, ...patch })));
  }

  async function fetchProgress(pending: BatchItem[]) {
    const progress = new Map<string, JobProgress>();
    const batchIds = [...new Set(pending.flatMap((item) => (item.batchId ? [item.batchId] : [])))];
    for (const batchId of batchIds) {
      const response = await fetch(`/api/expenses/ocr/batches/${batchId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo consultar el análisis."));
      const payload = (await response.json()) as { jobs: JobProgress[] };
      for (const job of payload.jobs) progress.set(job.id, job);
    }
    for (const item of pending.filter((candidate) => !candidate.batchId && candidate.jobId)) {
      const response = await fetch(`/api/expenses/ocr/${item.jobId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo consultar el análisis."));
      const job = (await response.json()) as Omit<JobProgress, "duplicateAssessment">;
      progress.set(job.id, { ...job, duplicateAssessment: emptyDuplicate });
    }
    return progress;
  }

  /**
   * Consulta el progreso mientras quede algo en análisis. No se detiene en silencio: si tarda
   * demasiado o el servidor no responde, pasa a "stalled" y se ofrece reintentar.
   */
  async function poll() {
    pollingGeneration.current += 1;
    const generation = pollingGeneration.current;
    setPollState("polling");
    const startedAt = Date.now();
    let failures = 0;
    for (let attempt = 0; pollingGeneration.current === generation; attempt += 1) {
      await sleep(attempt < 4 ? 1000 : 2500);
      if (pollingGeneration.current !== generation) return;
      const pending = itemsRef.current.filter((item) => item.jobId && (item.status === "PENDING" || item.status === "PROCESSING"));
      if (pending.length === 0) {
        setPollState("idle");
        return;
      }
      if (Date.now() - startedAt > POLL_STALL_MS || failures >= MAX_POLL_FAILURES) {
        setPollState("stalled");
        return;
      }
      try {
        const progress = await fetchProgress(pending);
        failures = 0;
        setItems((current) => current.map((item) => {
          const job = item.jobId ? progress.get(item.jobId) : undefined;
          return job ? mergeJobProgress(item, job, context) : item;
        }));
      } catch {
        failures += 1;
      }
    }
  }

  // Bandeja restaurada con documentos aún en análisis: retoma el seguimiento al entrar.
  useEffect(() => {
    const timer = initialJobs.some((job) => job.status === "PENDING" || job.status === "PROCESSING") ? window.setTimeout(() => void poll(), 0) : undefined;
    return () => {
      window.clearTimeout(timer);
      pollingGeneration.current += 1;
    };
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadOne(item: BatchItem, batchId: string) {
    patchItem(item.localId, { status: "UPLOADING" });
    const formData = new FormData();
    if (item.file) formData.set("file", item.file);
    formData.set("batchId", batchId);
    const endpoint = effectiveEngine === "openai" ? "/api/expenses/ai-analysis" : "/api/expenses/ocr";
    const response = await fetch(endpoint, { method: "POST", headers: getCsrfHeader(), body: formData });
    const payload = (await response.clone().json().catch(() => ({}))) as { id?: string; jobId?: string; fileUrl?: string; draft?: InboxJob["extracted"] };
    const jobId = payload.id ?? payload.jobId;
    if (!response.ok) {
      patchItem(item.localId, { jobId, fileUrl: payload.fileUrl ?? undefined });
      throw new Error(await readApiError(response, `No se pudo subir ${item.fileName}.`));
    }
    if (!jobId) throw new Error(`No se pudo subir ${item.fileName}: el servidor no devolvió el análisis.`);
    const provider = effectiveEngine === "openai" ? "openai" : "tesseract";
    patchItem(item.localId, (current) => {
      const withJob: BatchItem = { ...current, jobId, batchId, provider, fileUrl: payload.fileUrl ?? `/api/expenses/ocr/${jobId}/file` };
      return payload.draft
        ? mergeJobProgress(withJob, { status: "DONE", errorMessage: null, extracted: payload.draft, duplicateAssessment: emptyDuplicate, extractionProvider: provider }, context)
        : { ...withJob, status: "PENDING" };
    });
  }

  function validateFiles(files: File[]) {
    if (files.length === 0) return false;
    if (files.length > MAX_FILES) {
      toast.error(`Selecciona como máximo ${MAX_FILES} archivos por lote.`);
      return false;
    }
    const invalid = files.find((file) => file.size > MAX_FILE_BYTES);
    if (invalid) {
      toast.error(`${invalid.name} supera el límite de 12 MB.`);
      return false;
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) {
      toast.error("El lote supera el límite total de 120 MB.");
      return false;
    }
    return true;
  }

  async function startBatch(files: File[]) {
    if (!validateFiles(files)) return;
    setIsStarting(true);
    const newItems = files.map((file) => newBatchItem({ file, fileName: file.name, sizeBytes: file.size, contentType: file.type }));
    setItems((current) => [...current, ...newItems]);
    try {
      const response = await fetch("/api/expenses/ocr/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ expectedFiles: files.length }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo crear el lote de facturas."));
      const batch = (await response.json().catch(() => ({}))) as { id?: string };
      const batchId = batch.id;
      if (!batchId) throw new Error("No se pudo crear el lote de facturas. Inténtalo de nuevo.");
      let cursor = 0;
      const workers = Array.from({ length: Math.min(3, newItems.length) }, async () => {
        while (cursor < newItems.length) {
          const item = newItems[cursor++];
          try {
            await uploadOne(item, batchId);
          } catch (error) {
            patchItem(item.localId, { status: "FAILED", error: errorMessage(error, `No se pudo subir ${item.fileName}.`) });
          }
        }
      });
      await Promise.all(workers);
      toast.success(`${files.length === 1 ? "Archivo subido" : `${files.length} archivos subidos`}; el análisis continúa en segundo plano.`);
      void poll();
    } catch (error) {
      const message = errorMessage(error, "No se pudo iniciar el lote.");
      const ids = new Set(newItems.map((item) => item.localId));
      setItems((current) => current.map((item) => (ids.has(item.localId) ? { ...item, status: "FAILED", error: message } : item)));
      toast.error(message);
    } finally {
      setIsStarting(false);
    }
  }

  async function checkDuplicate(item: BatchItem, totalAmount: number) {
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
    if (!response.ok) throw new Error(await readApiError(response, "No se pudo comprobar si la factura está duplicada."));
    return (await response.json()) as DuplicateAssessment;
  }

  /** Registra un documento. Devuelve true si quedó registrado. */
  async function postItem(item: BatchItem, options: { bulk?: boolean } = {}) {
    if (!item.jobId || item.status !== "DONE") return false;
    const readiness = assessReadiness(toReviewItem(item), baseCurrencyCode);
    // Al registrar uno a uno no hace falta "revisada": el propio clic es la revisión.
    const blocking = readiness.reasons.filter((reason) => reason !== "confidence");
    if (blocking.length > 0) {
      patchItem(item.localId, { error: `No se puede registrar todavía: ${blocking.map((reason) => reviewReasonLabels[reason].toLocaleLowerCase("es-ES")).join(", ")}.` });
      if (!options.bulk) setOpenItemId(item.localId);
      return false;
    }
    try {
      const duplicate = await checkDuplicate(item, readiness.total);
      patchItem(item.localId, { duplicate });
      if (duplicate.level === "exact") throw new Error("Documento duplicado: ya existe esta factura. Revísala antes de continuar.");
      if (duplicate.level === "possible" && !item.acknowledgePossible) throw new Error("Hay otra factura del mismo proveedor, fecha e importe. Confirma que es distinta antes de registrar.");
      patchItem(item.localId, { status: "POSTING", error: undefined });
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
          issueDate: isoDate(item.issueDate),
          dueDate: item.dueDate ? isoDate(item.dueDate) : undefined,
          currencyCode: item.currencyCode,
          vatTreatment: item.vatTreatment || undefined,
          ocrJobId: item.jobId,
          idempotencyKey: `expense-ocr-job:${item.jobId}`,
          lines: item.lines.map((line) => ({
            expenseAccountId: line.expenseAccountId,
            description: line.description.trim(),
            quantity: parseQuantity(line.quantity),
            unitPrice: parseMoney(line.unitPrice),
            taxRate: parsePercent(line.taxRate),
            taxDeductiblePct: parsePercent(line.taxDeductiblePct),
            retentionRate: parsePercent(line.retentionRate),
          })),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar la factura."));
      const payload = (await response.json().catch(() => ({}))) as { id?: string };
      if (!payload.id) throw new Error("No se pudo registrar la factura: el servidor no devolvió su identificador.");
      patchItem(item.localId, { status: "POSTED", createdExpenseId: payload.id, error: undefined });
      if (!options.bulk) {
        toast.success(`${item.fileName} se ha registrado.`);
        const next = itemsRef.current.find((candidate) => candidate.localId !== item.localId && candidate.status === "DONE");
        setOpenItemId(next?.localId ?? null);
      }
      return true;
    } catch (error) {
      const message = errorMessage(error, "No se pudo registrar la factura.");
      patchItem(item.localId, { status: "DONE", error: message });
      if (!options.bulk) toast.error(`${item.fileName}: ${message}`);
      return false;
    }
  }

  async function postReady() {
    setBulkPosting(true);
    let posted = 0;
    let failed = 0;
    try {
      for (const entry of safeToPost.ready) {
        const current = itemsRef.current.find((item) => item.localId === entry.item.source.localId);
        if (!current) continue;
        if (await postItem(current, { bulk: true })) posted += 1;
        else failed += 1;
      }
    } finally {
      setBulkPosting(false);
      setConfirmOpen(false);
    }
    if (posted > 0) toast.success(`${posted === 1 ? "1 factura registrada" : `${posted} facturas registradas`}.`);
    if (failed > 0) toast.error(`${failed === 1 ? "1 factura no se pudo registrar" : `${failed} facturas no se pudieron registrar`}: revisa los avisos.`);
  }

  async function retryItem(item: BatchItem) {
    if (!item.jobId) return;
    patchItem(item.localId, { status: "PENDING", error: undefined });
    const response = await fetch(`/api/expenses/ocr/${item.jobId}`, { method: "POST", headers: getCsrfHeader() });
    if (!response.ok) {
      const message = await readApiError(response, "No se pudo reintentar el análisis.");
      toast.error(message);
      return patchItem(item.localId, { status: "FAILED", error: message });
    }
    toast.success(`Reanalizando ${item.fileName}…`);
    void poll();
  }

  async function discardItem() {
    const target = discardTarget;
    if (!target) return;
    if (!target.jobId) {
      setItems((current) => current.filter((item) => item.localId !== target.localId));
      setDiscardTarget(null);
      return;
    }
    setDiscarding(true);
    try {
      const response = await fetch(`/api/expenses/ocr/${target.jobId}`, { method: "DELETE", headers: getCsrfHeader() });
      if (!response.ok && response.status !== 404) throw new Error(await readApiError(response, "No se pudo descartar el documento."));
      setItems((current) => current.filter((item) => item.localId !== target.localId));
      if (openItemId === target.localId) setOpenItemId(null);
      toast.success(`${target.fileName} se ha quitado de la bandeja.`);
      setDiscardTarget(null);
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo descartar el documento."));
    } finally {
      setDiscarding(false);
    }
  }

  async function toggleExternalAi(enabled: boolean) {
    try {
      const response = await fetch("/api/expenses/ocr/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ externalAiEnabled: enabled }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la preferencia."));
      setAiSettings((current) => ({ ...current, externalAiEnabled: enabled }));
      if (!enabled) setEngine("local");
      toast.success(enabled ? "Análisis con OpenAI permitido para la empresa." : "Análisis con OpenAI desactivado: solo se usará el OCR local.");
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo guardar la preferencia."));
    }
  }

  const summaryLine = items.length === 0
    ? "Bandeja vacía."
    : [
        `${counts.total} documento${counts.total === 1 ? "" : "s"}`,
        counts.processing > 0 ? `${counts.processing} en análisis` : null,
        counts.review > 0 ? `${counts.review} por revisar (${counts.ready} listo${counts.ready === 1 ? "" : "s"} para registrar)` : null,
        counts.posted > 0 ? `${counts.posted} registrado${counts.posted === 1 ? "" : "s"}` : null,
        counts.failed > 0 ? `${counts.failed} con error` : null,
      ].filter(Boolean).join(" · ");

  const busy = isStarting || bulkPosting;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 border-b border-window-shadow pb-3 md:flex-row md:items-end md:justify-between">
        <div>
          {onBack ? (
            <Button className="mb-2" onClick={onBack} size="sm" type="button" variant="ghost">
              <ArrowLeft aria-hidden="true" /> Cambiar modo
            </Button>
          ) : backHref ? (
            <Link className="mb-2 inline-flex items-center gap-1 font-mono text-xs font-bold text-primary hover:underline" href={backHref}>
              <ArrowLeft aria-hidden="true" /> Registrar a mano
            </Link>
          ) : null}
          <h2 className="font-mono text-base font-bold">Bandeja de facturas</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Sube las facturas y tickets; se leen solos. Revisa cada uno junto a su imagen y regístralo. Lo que dejes a medias queda guardado aquí.
          </p>
        </div>
        {items.length > 0 ? (
          <div className="flex flex-col items-start gap-1 md:items-end">
            <Button disabled={safeToPost.ready.length === 0 || busy} onClick={() => setConfirmOpen(true)} type="button">
              Registrar preparados ({safeToPost.ready.length})
            </Button>
            <p className="max-w-xs text-xs text-muted-foreground md:text-right">
              Solo entran los documentos con cuenta de gasto propuesta o elegida, sin avisos y bien leídos o marcados como revisados.
            </p>
          </div>
        ) : null}
      </header>

      <section aria-label="Subir facturas" className="grid gap-3 border border-window-dark-shadow bg-window-panel p-3 shadow-[inset_1px_1px_0_var(--window-highlight)] lg:grid-cols-[260px_1fr] lg:items-start">
        <div className="space-y-2">
          {aiAvailable ? (
            <AccessibleField
              helperText={effectiveEngine === "local" ? "El OCR local lee el documento en tu servidor: no sale del ERP." : undefined}
              id="expense-batch-engine"
              label="Cómo leer los documentos"
            >
              <Select disabled={busy} id="expense-batch-engine" onChange={(event) => setEngine(event.target.value === "openai" ? "openai" : "local")} value={engine}>
                <option value="local">OCR local (privado)</option>
                <option value="openai">OpenAI (más preciso, servicio externo)</option>
              </Select>
            </AccessibleField>
          ) : (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono font-bold text-foreground">Lectura con OCR local.</span> Los documentos se leen en tu servidor y no salen del ERP.
            </p>
          )}
          {effectiveEngine === "openai" ? (
            <p className="border border-warning bg-warning/10 p-2 text-xs text-warning-text" role="note">
              <strong>Aviso de privacidad:</strong> con OpenAI el documento completo (datos del proveedor, importes y cualquier dato personal que contenga) se envía a OpenAI, un proveedor externo con servidores fuera de la UE, para leerlo. Úsalo solo si tu empresa lo permite.
            </p>
          ) : null}
          {canManageAiSettings && aiSettings.externalAiConfigured ? (
            <label className="flex items-start gap-2 text-xs" htmlFor="expense-external-ai-enabled">
              <input
                checked={aiSettings.externalAiEnabled}
                className="mt-0.5"
                id="expense-external-ai-enabled"
                onChange={(event) => void toggleExternalAi(event.target.checked)}
                type="checkbox"
              />
              <span>Permitir leer facturas con OpenAI en esta empresa (preferencia de administración).</span>
            </label>
          ) : null}
        </div>
        <div className="space-y-2">
          <label
            className={cn(
              "group flex min-h-24 cursor-pointer items-center justify-center gap-3 border border-dashed border-window-dark-shadow bg-card px-5 text-center transition-colors hover:bg-window-highlight has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
              busy && "cursor-wait opacity-60",
            )}
            htmlFor="expense-batch-files"
          >
            <UploadSimple className="size-6 text-primary" aria-hidden="true" />
            <span>
              <span className="block font-mono text-sm font-bold">{isStarting ? "Subiendo…" : "Seleccionar facturas"}</span>
              <span className="block text-xs text-muted-foreground" id="expense-batch-files-helper">PDF, PNG, JPG o WEBP · hasta 50 archivos de 12 MB</span>
            </span>
            <input
              accept={ACCEPTED_TYPES}
              aria-describedby="expense-batch-files-helper"
              className="sr-only"
              disabled={busy}
              id="expense-batch-files"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void startBatch(files);
              }}
              type="file"
            />
          </label>
          {/* Móvil: foto directa con la cámara trasera; se pueden hacer varias antes de analizarlas. */}
          <div className="space-y-2 sm:hidden">
            <label className={cn("flex min-h-12 cursor-pointer items-center justify-center gap-2 border border-window-dark-shadow bg-primary px-3 font-mono text-sm font-bold text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus", busy && "opacity-60")} htmlFor="expense-batch-camera">
              <Camera aria-hidden="true" className="size-5" />
              {shots.length === 0 ? "Hacer foto del ticket" : "Hacer otra foto"}
              <input
                accept="image/*"
                capture="environment"
                className="sr-only"
                disabled={busy}
                id="expense-batch-camera"
                onChange={(event) => {
                  const photo = event.target.files?.[0];
                  event.target.value = "";
                  if (photo) setShots((current) => [...current, photo]);
                }}
                type="file"
              />
            </label>
            {shots.length > 0 ? (
              <div className="flex items-center justify-between gap-2 border border-window-dark-shadow bg-card p-2 text-xs">
                <span aria-live="polite">{shots.length === 1 ? "1 foto preparada" : `${shots.length} fotos preparadas`}</span>
                <span className="flex gap-1">
                  <Button onClick={() => setShots([])} size="sm" type="button" variant="ghost">Descartar</Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      const pendingShots = shots;
                      setShots([]);
                      void startBatch(pendingShots);
                    }}
                    size="sm"
                    type="button"
                  >
                    Leer {shots.length === 1 ? "la foto" : `${shots.length} fotos`}
                  </Button>
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <p aria-live="polite" className="sr-only">{summaryLine}</p>

      {items.length > 0 ? (
        <dl className="grid grid-cols-2 gap-px border border-window-dark-shadow bg-window-shadow md:grid-cols-5">
          {([["Documentos", counts.total], ["En análisis", counts.processing], ["Por revisar", counts.review], ["Registrados", counts.posted], ["Con error", counts.failed]] as const).map(([label, value]) => (
            <div className="bg-card px-3 py-2" key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-mono text-lg font-bold tabular-nums">{value}</dd></div>
          ))}
        </dl>
      ) : null}

      {pollState === "stalled" ? (
        <div className="flex flex-col gap-2 border border-warning bg-warning/10 p-2 text-xs text-warning-text sm:flex-row sm:items-center sm:justify-between" role="status">
          <p>
            <strong>Sigue procesando…</strong> Algunos documentos tardan más de lo normal o no hemos podido consultar su estado. Puedes seguir revisando los demás o volver más tarde a «Bandeja pendiente».
          </p>
          <Button onClick={() => void poll()} size="sm" type="button" variant="outline">Reintentar</Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center border border-dashed border-window-dark-shadow bg-window-panel text-center">
          <FileText className="mb-2 size-7 text-muted-foreground" aria-hidden="true" />
          <p className="font-mono text-sm font-bold">No hay documentos pendientes</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">Pulsa «Seleccionar facturas» para subir uno o varios archivos; quedarán en esta bandeja hasta que los registres.</p>
        </div>
      ) : (
        <ol className="space-y-2" aria-label="Documentos de la bandeja">
          {items.map((item, index) => {
            const readiness = item.status === "DONE" ? assessReadiness(toReviewItem(item), baseCurrencyCode) : null;
            const isOpen = openItemId === item.localId && (item.status === "DONE" || item.status === "POSTING");
            const supplierLabel = item.supplierPartnerId
              ? suppliers.find((supplier) => supplier.id === item.supplierPartnerId)?.name
              : item.supplierName || item.supplierTaxId;
            return (
              <li aria-labelledby={`batch-item-${item.localId}-title`} className="border border-window-dark-shadow bg-card shadow-[inset_1px_1px_0_var(--window-highlight)]" key={item.localId}>
                <div className="flex flex-col gap-2 bg-window-panel px-3 py-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    {item.status === "POSTED" ? <CheckCircle aria-hidden="true" className="size-5 shrink-0 text-success" weight="fill" />
                      : item.status === "FAILED" ? <XCircle aria-hidden="true" className="size-5 shrink-0 text-destructive" weight="fill" />
                        : PROCESSING_STATUSES.includes(item.status) || item.status === "POSTING" ? <SpinnerGap aria-hidden="true" className="size-5 shrink-0 animate-spin text-primary" />
                          : <FileText aria-hidden="true" className="size-5 shrink-0 text-primary" />}
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-bold" id={`batch-item-${item.localId}-title`}>{index + 1}. {supplierLabel || item.fileName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {statusLabel(item.status)}
                        {item.supplierDocumentNumber ? ` · ${item.supplierDocumentNumber}` : ""}
                        {readiness ? ` · ${formatMoney(readiness.total, item.currencyCode)}` : ""}
                        {supplierLabel ? ` · ${item.fileName}` : ` · ${formatAmount(item.sizeBytes / 1024 / 1024)} MB`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {readiness?.ready ? <StatusBadge tone="success">Listo</StatusBadge> : null}
                    {readiness && !readiness.ready ? readiness.reasons.slice(0, 3).map((reason) => (
                      <StatusBadge key={reason} tone={reason === "account" || reason === "duplicate" || reason === "totals" ? "warning" : "neutral"}>{reviewReasonLabels[reason]}</StatusBadge>
                    )) : null}
                    {item.createdExpenseId ? <Link className="font-mono text-xs font-bold text-primary hover:underline" href={`/expenses/${item.createdExpenseId}`}>Abrir factura</Link> : null}
                    {item.status === "DONE" ? (
                      <Button aria-expanded={isOpen} onClick={() => setOpenItemId(isOpen ? null : item.localId)} size="sm" type="button" variant={isOpen ? "outline" : "default"}>
                        {isOpen ? "Cerrar" : "Revisar"}
                      </Button>
                    ) : null}
                    {item.status === "FAILED" && item.jobId ? <Button onClick={() => void retryItem(item)} size="sm" type="button" variant="outline">Reintentar</Button> : null}
                    {(item.status === "PENDING" || item.status === "PROCESSING") && pollState === "stalled" && item.jobId ? (
                      <Button onClick={() => void retryItem(item)} size="sm" type="button" variant="outline">Reintentar análisis</Button>
                    ) : null}
                    {item.status !== "POSTED" && item.status !== "POSTING" && item.status !== "UPLOADING" ? (
                      <Button aria-label={`Descartar ${item.fileName}`} onClick={() => setDiscardTarget(item)} size="icon-sm" title="Quitar de la bandeja" type="button" variant="ghost">
                        <Trash aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {item.status === "FAILED" && item.error ? (
                  <p className="flex items-start gap-2 border-t border-window-shadow px-3 py-2 font-mono text-xs text-destructive" role="alert">
                    <WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" /> {item.error}
                  </p>
                ) : null}
                {isOpen ? (
                  <ExpenseBatchItemReview
                    baseCurrencyCode={baseCurrencyCode}
                    expenseAccounts={expenseAccounts}
                    goodsReceipts={goodsReceipts}
                    item={item}
                    onPatch={(patch) => patchItem(item.localId, patch)}
                    onPost={() => void postItem(item)}
                    purchaseOrders={purchaseOrders}
                    readiness={readiness}
                    suppliers={suppliers}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <Dialog
        description={`Se registrarán ${safeToPost.ready.length === 1 ? "1 factura" : `${safeToPost.ready.length} facturas`} por ${formatMoney(safeToPost.total, baseCurrencyCode)}. Cada una se contabiliza con la cuenta que ves; las demás siguen en la bandeja para revisarlas.`}
        initialFocusId="expense-bulk-cancel"
        onClose={() => { if (!bulkPosting) setConfirmOpen(false); }}
        open={confirmOpen}
        size="lg"
        title="Registrar facturas preparadas"
      >
        <ul className="max-h-72 space-y-1 overflow-y-auto border border-window-shadow p-2 text-xs">
          {safeToPost.ready.map(({ item: entry, total }) => {
            const source = entry.source;
            const supplierLabel = source.supplierPartnerId ? suppliers.find((supplier) => supplier.id === source.supplierPartnerId)?.name : source.supplierName || source.supplierTaxId;
            const accounts = [...new Set(source.lines.map((line) => expenseAccounts.find((account) => account.id === line.expenseAccountId)?.code ?? ""))].filter(Boolean);
            return (
              <li className="flex items-start justify-between gap-3 border-b border-window-shadow pb-1 last:border-b-0" key={source.localId}>
                <span className="min-w-0">
                  <span className="block truncate font-mono font-bold">{supplierLabel} · {source.supplierDocumentNumber}</span>
                  <span className="block text-muted-foreground">Cuenta {accounts.join(", ")} · {source.fileName}</span>
                </span>
                <span className="shrink-0 font-mono font-bold tabular-nums">{formatMoney(total, source.currencyCode)}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 font-mono text-sm font-bold">Total: {formatMoney(safeToPost.total, baseCurrencyCode)}</p>
        <DialogFooter>
          <Button disabled={bulkPosting} id="expense-bulk-cancel" onClick={() => setConfirmOpen(false)} type="button" variant="outline">Cancelar</Button>
          <Button disabled={bulkPosting || safeToPost.ready.length === 0} onClick={() => void postReady()} type="button">
            {bulkPosting ? "Registrando…" : `Registrar ${safeToPost.ready.length === 1 ? "1 factura" : `${safeToPost.ready.length} facturas`}`}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        description={discardTarget ? `«${discardTarget.fileName}» se quitará de la bandeja y se borrará el archivo subido. No afecta a ninguna factura registrada.` : undefined}
        initialFocusId="expense-discard-cancel"
        onClose={() => { if (!discarding) setDiscardTarget(null); }}
        open={Boolean(discardTarget)}
        size="sm"
        title="Descartar documento"
      >
        <DialogFooter>
          <Button disabled={discarding} id="expense-discard-cancel" onClick={() => setDiscardTarget(null)} type="button" variant="outline">Cancelar</Button>
          <Button disabled={discarding} onClick={() => void discardItem()} type="button" variant="destructive">{discarding ? "Descartando…" : "Descartar"}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
