"use client";

import { ArrowSquareOut, CaretLeft, CaretRight, FileText, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DocumentSource =
  | { kind: "url"; url: string; contentType: string; fileName: string }
  | { kind: "file"; file: File };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

let workerReady: Promise<typeof import("pdfjs-dist")> | null = null;

/**
 * Carga pdf.js en el navegador con su worker empaquetado (mismo origen: la CSP no admite
 * blob: ni marcos). Se carga una sola vez y solo cuando hay un PDF que enseñar.
 */
function loadPdfJs() {
  workerReady ??= import("pdfjs-dist").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    }
    return pdfjs;
  });
  return workerReady;
}

function sourceContentType(source: DocumentSource) {
  return source.kind === "file" ? source.file.type : source.contentType;
}

function sourceName(source: DocumentSource) {
  return source.kind === "file" ? source.file.name : source.fileName;
}

/** Imagen de un File como data: URL (la CSP permite `img-src data:` pero no `blob:`). */
function useImageUrl(source: DocumentSource) {
  const [dataUrl, setDataUrl] = useState<{ file: File; url: string } | null>(null);
  const file = source.kind === "file" ? source.file : null;
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setDataUrl({ file, url: reader.result });
    };
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);
  if (source.kind === "url") return source.url;
  return dataUrl?.file === file ? dataUrl.url : null;
}

function PdfCanvas({ file, onPageCount, page, url, zoom }: { file: File | null; onPageCount: (count: number) => void; page: number; url: string | null; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceKey = file ?? url;
  const [documentState, setDocumentState] = useState<{ key: File | string | null; pdf: PDFDocumentProxy | null; error: boolean }>({ key: null, pdf: null, error: false });
  const currentPdf = documentState.key === sourceKey ? documentState.pdf : null;
  const failed = documentState.key === sourceKey && documentState.error;

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const data = file ? new Uint8Array(await file.arrayBuffer()) : undefined;
        if (!data && !url) throw new Error("Sin documento.");
        const task = pdfjs.getDocument(data ? { data } : { url: url ?? "", withCredentials: true });
        loadingTask = task;
        const pdf = await task.promise;
        if (cancelled) return;
        onPageCount(pdf.numPages);
        setDocumentState({ key: file ?? url, pdf, error: false });
      } catch {
        if (!cancelled) setDocumentState({ key: file ?? url, pdf: null, error: true });
      }
    })();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
    // onPageCount es el setState del padre (estable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, url]);

  useEffect(() => {
    if (!currentPdf || !canvasRef.current) return;
    let renderTask: RenderTask | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const pdfPage = await currentPdf.getPage(Math.min(Math.max(page, 1), currentPdf.numPages));
        if (cancelled || !canvasRef.current) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: zoom * pixelRatio });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
        renderTask = pdfPage.render({ canvas, viewport });
        await renderTask.promise;
      } catch {
        // Una renderización cancelada (cambio de página o zoom) no es un error.
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [currentPdf, page, zoom]);

  if (failed) {
    return (
      <p className="p-4 text-center text-xs text-muted-foreground">
        No se ha podido mostrar el PDF aquí. Ábrelo en una pestaña nueva para revisarlo.
      </p>
    );
  }
  return (
    <>
      {!currentPdf ? <p className="p-4 text-center text-xs text-muted-foreground">Cargando documento…</p> : null}
      <canvas aria-label={`Página ${page} del documento`} className={cn("mx-auto block max-w-none bg-white", !currentPdf && "hidden")} ref={canvasRef} role="img" />
    </>
  );
}

/**
 * Vista del documento original junto a los datos leídos: imagen o PDF (con páginas), zoom
 * y enlace para abrirlo aparte. Se usa en la revisión de la bandeja de facturas.
 */
export function DocumentPreview({ className, source }: { className?: string; source: DocumentSource }) {
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const contentType = sourceContentType(source);
  const isPdf = contentType === "application/pdf";
  const imageUrl = useImageUrl(source);
  const openUrl = source.kind === "url" ? source.url : null;

  return (
    <section aria-label={`Documento original: ${sourceName(source)}`} className={cn("flex min-h-0 flex-col border border-window-dark-shadow bg-window-panel", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-window-shadow px-2 py-1">
        <FileText aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate font-mono text-xs font-bold" title={sourceName(source)}>{sourceName(source)}</p>
        <Button aria-label="Alejar" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))} size="icon" title="Alejar" type="button" variant="ghost">
          <MagnifyingGlassMinus aria-hidden="true" />
        </Button>
        <span aria-live="polite" className="w-10 text-center font-mono text-xs tabular-nums">{Math.round(zoom * 100)} %</span>
        <Button aria-label="Acercar" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))} size="icon" title="Acercar" type="button" variant="ghost">
          <MagnifyingGlassPlus aria-hidden="true" />
        </Button>
        {openUrl ? (
          <a className="inline-flex items-center gap-1 px-1 font-mono text-xs font-bold text-primary hover:underline" href={openUrl} rel="noreferrer" target="_blank">
            <ArrowSquareOut aria-hidden="true" /> Abrir
          </a>
        ) : null}
      </div>
      {isPdf && pageCount > 1 ? (
        <nav aria-label="Páginas del documento" className="flex items-center justify-center gap-2 border-b border-window-shadow px-2 py-1 text-xs">
          <Button aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} size="icon" type="button" variant="ghost">
            <CaretLeft aria-hidden="true" />
          </Button>
          <span className="font-mono tabular-nums">Página {page} de {pageCount}</span>
          <Button aria-label="Página siguiente" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} size="icon" type="button" variant="ghost">
            <CaretRight aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
      <div className="min-h-64 flex-1 overflow-auto bg-window-shadow/40 p-2" tabIndex={0}>
        {isPdf ? (
          <PdfCanvas file={source.kind === "file" ? source.file : null} onPageCount={setPageCount} page={page} url={source.kind === "url" ? source.url : null} zoom={zoom} />
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- documento privado servido por la API, sin optimización de imagen
          <img alt={`Documento ${sourceName(source)}`} className="mx-auto block max-w-none origin-top" src={imageUrl} style={{ width: `${zoom * 100}%` }} />
        ) : (
          <p className="p-4 text-center text-xs text-muted-foreground">Cargando documento…</p>
        )}
      </div>
    </section>
  );
}
