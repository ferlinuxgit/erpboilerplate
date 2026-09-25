"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";

const FAILURE = "No se pudo generar el paquete para el gestor.";

/** Descarga el ZIP del paquete para el gestor mostrando el progreso (puede tardar unos segundos). */
export function GestorPackageDownload({ fiscalYearId, periodKey, periodLabel }: { fiscalYearId: string; periodKey: string; periodLabel: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function download() {
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch(`/api/accounting/gestor-package?year=${encodeURIComponent(fiscalYearId)}&period=${encodeURIComponent(periodKey)}`);
      if (!response.ok) throw new Error(await readApiError(response, FAILURE));
      const fileName = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "paquete-gestor.zip";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState("done");
      setMessage(`Paquete de ${periodLabel} descargado (${fileName}).`);
      toast.success("Paquete para el gestor descargado.");
    } catch (error) {
      const text = errorMessage(error, FAILURE);
      setState("error");
      setMessage(text);
      toast.error(text);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button aria-busy={state === "loading"} disabled={state === "loading"} onClick={() => void download()} type="button">
        <DownloadSimple aria-hidden="true" />
        {state === "loading" ? "Preparando el ZIP…" : "Descargar paquete (ZIP)"}
      </Button>
      <p aria-live="polite" className={state === "error" ? "text-sm text-danger-text" : "text-sm text-muted-foreground"} role="status">
        {message ?? (state === "loading" ? "Generando libros y modelos; puede tardar unos segundos." : "")}
      </p>
    </div>
  );
}
