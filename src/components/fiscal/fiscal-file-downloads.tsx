"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { hasPresentationFile, PRESENTATION_FILE_DESIGNS } from "@/server/fiscal-files/models";

const FAILURE = "No se pudo generar el fichero para la sede de la AEAT.";

function readWarnings(header: string | null): string[] {
  if (!header) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Descarga del fichero de presentación de un modelo (303, 111, 115, 130, 347 y 349) para importarlo
 * en la sede de la AEAT. No pinta nada en los modelos que no tienen fichero.
 */
export function FiscalFileDownloads({ code, reportId }: { code: string; reportId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (!hasPresentationFile(code)) return null;

  async function download() {
    setState("loading");
    setMessage(null);
    setWarnings([]);
    try {
      const response = await fetch(`/api/fiscal-files/presentation/${encodeURIComponent(reportId)}`);
      if (!response.ok) throw new Error(await readApiError(response, FAILURE));
      const fileName = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `${code}.txt`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setWarnings(readWarnings(response.headers.get("X-Fiscal-File-Warnings")));
      setState("done");
      setMessage(`Fichero descargado (${fileName}).`);
      toast.success("Fichero para la sede descargado.");
    } catch (error) {
      const text = errorMessage(error, FAILURE);
      setState("error");
      setMessage(text);
      toast.error(FAILURE);
    }
  }

  return (
    <section aria-label="Fichero para la sede de la AEAT" className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button aria-busy={state === "loading"} disabled={state === "loading"} onClick={() => void download()} type="button" variant="secondary">
          <DownloadSimple aria-hidden="true" />
          {state === "loading" ? "Generando el fichero…" : "Descargar fichero para la Sede de la AEAT"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Impórtalo en la sede y revísalo antes de firmar. <span className="text-xs">{PRESENTATION_FILE_DESIGNS[code]}.</span>
        </p>
      </div>
      <div aria-live="polite" role="status">
        {message ? <p className={state === "error" ? "text-sm text-danger-text" : "text-sm text-muted-foreground"}>{message}</p> : null}
        {warnings.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
