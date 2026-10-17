"use client";

import { CheckCircle, FileArrowUp, Question, SpinnerGap } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { readApiError } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";
import { cn } from "@/lib/utils";

type RestoredInvoice = { id: string; number: string; supplierName: string };
type FileResult =
  | { fileName: string; status: "pending" | "uploading" }
  | { fileName: string; status: "restored" | "already-available"; invoices: RestoredInvoice[] }
  | { fileName: string; status: "unmatched" }
  | { fileName: string; status: "error"; message: string };

const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * Recuperación en bloque: se sueltan los PDF originales y cada uno vuelve a su factura si es el
 * mismo archivo que se subió (misma huella). Se envían de uno en uno para ver el progreso.
 */
export function ExpenseDocumentRecovery({ missingCount }: { missingCount: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<FileResult[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function restoreAll(files: File[]) {
    if (files.length === 0 || running) return;
    setRunning(true);
    setResults(files.map((file) => ({ fileName: file.name, status: "pending" })));
    const update = (index: number, result: FileResult) => setResults((current) => current.map((entry, position) => (position === index ? result : entry)));
    for (const [index, file] of files.entries()) {
      if (file.size > MAX_FILE_BYTES) {
        update(index, { fileName: file.name, status: "error", message: "Supera 12 MB." });
        continue;
      }
      update(index, { fileName: file.name, status: "uploading" });
      try {
        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch("/api/expenses/documents/restore", { method: "POST", headers: getCsrfHeader(), body: formData });
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo procesar el archivo."));
        const payload = (await response.json()) as { status: "restored" | "already-available" | "unmatched"; invoices?: RestoredInvoice[] };
        update(index, payload.status === "unmatched" ? { fileName: file.name, status: "unmatched" } : { fileName: file.name, status: payload.status, invoices: payload.invoices ?? [] });
      } catch (error) {
        update(index, { fileName: file.name, status: "error", message: error instanceof Error ? error.message : "No se pudo procesar el archivo." });
      }
    }
    setRunning(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  const restored = results.filter((result) => result.status === "restored").length;
  const unmatched = results.filter((result) => result.status === "unmatched").length;
  const done = !running && results.length > 0;

  return (
    <div className="space-y-3">
      <div
        className={cn("flex flex-col items-center gap-2 border-2 border-dashed p-6 text-center", dragging ? "border-link bg-link/5" : "border-window-shadow")}
        data-testid="document-recovery-dropzone"
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void restoreAll([...event.dataTransfer.files]);
        }}
      >
        <FileArrowUp aria-hidden="true" className="size-7 text-muted-foreground" />
        <p className="font-mono text-sm font-bold">Suelta aquí los PDF originales o selecciónalos</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Puedes soltarlos todos a la vez, aunque haya otros que no falten: solo se repone el que es exactamente el mismo archivo que se subió en su día, nunca en otra factura.
        </p>
        <input
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="sr-only"
          data-testid="document-recovery-input"
          multiple
          onChange={(event) => void restoreAll([...(event.target.files ?? [])])}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
        <Button disabled={running || missingCount === 0} onClick={() => inputRef.current?.click()} type="button">
          {running ? "Recuperando…" : "Seleccionar archivos"}
        </Button>
      </div>

      {done ? (
        <p className="text-sm" role="status">
          {restored} {restored === 1 ? "documento repuesto" : "documentos repuestos"}
          {unmatched > 0 ? ` · ${unmatched} sin coincidencia: si son otra descarga del mismo documento, repónlos desde la ficha de su factura.` : "."}
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul aria-label="Resultado por archivo" className="space-y-1 text-xs">
          {results.map((result, index) => (
            <li className="flex flex-wrap items-center justify-between gap-2 border-b border-window-shadow py-1 last:border-b-0" key={`${result.fileName}-${index}`}>
              <span className="flex min-w-0 items-center gap-2">
                {result.status === "uploading" ? <SpinnerGap aria-hidden="true" className="size-4 animate-spin text-link" />
                  : result.status === "restored" || result.status === "already-available" ? <CheckCircle aria-hidden="true" className="size-4 text-success" weight="fill" />
                    : <Question aria-hidden="true" className="size-4 text-muted-foreground" />}
                <span className="truncate font-mono">{result.fileName}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {result.status === "pending" ? <span className="text-muted-foreground">En cola</span> : null}
                {result.status === "uploading" ? <span className="text-muted-foreground">Comprobando…</span> : null}
                {result.status === "restored" || result.status === "already-available" ? (
                  <>
                    <StatusBadge tone={result.status === "restored" ? "success" : "neutral"}>{result.status === "restored" ? "Repuesto" : "Ya estaba"}</StatusBadge>
                    {result.invoices.map((invoice) => (
                      <Link className="font-mono font-bold text-link hover:underline" href={`/expenses/${invoice.id}`} key={invoice.id}>{invoice.number} · {invoice.supplierName}</Link>
                    ))}
                  </>
                ) : null}
                {result.status === "unmatched" ? <StatusBadge tone="warning">Sin coincidencia</StatusBadge> : null}
                {result.status === "error" ? <StatusBadge tone="danger">{result.message}</StatusBadge> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
