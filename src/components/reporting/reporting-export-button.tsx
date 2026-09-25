"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type ExportState = "idle" | "loading" | "success" | "error";

const EXPORT_FAILURE = "No se pudo generar el Excel. Reinténtalo.";

function stateCopy(state: ExportState) {
  switch (state) {
    case "loading":
      return "Preparando exportación…";
    case "success":
      return "Excel listo para descargar.";
    case "error":
      return EXPORT_FAILURE;
    default:
      return "Descarga estos indicadores en un Excel para compartirlos.";
  }
}

export function ReportingExportButton({ period = "month" }: { period?: "month" | "quarter" | "year" }) {
  const [state, setState] = useState<ExportState>("idle");
  const [failure, setFailure] = useState<string | null>(null);

  async function handleExport() {
    setState("loading");
    setFailure(null);

    try {
      const response = await fetch(period === "month" ? "/api/reporting/export" : `/api/reporting/export?period=${period}`);
      if (!response.ok) {
        throw new Error(await readApiError(response, EXPORT_FAILURE));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `indicadores-${period}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState("success");
    } catch (error) {
      setFailure(errorMessage(error, EXPORT_FAILURE));
      setState("error");
    }
  }

  return (
    <div className="space-y-2">
      <Button aria-busy={state === "loading" || undefined} disabled={state === "loading"} onClick={handleExport} type="button" variant="secondary">
        {state === "loading" ? "Preparando Excel…" : "Exportar indicadores a Excel"}
      </Button>
      <p
        aria-live="polite"
        className={cn(
          "font-mono text-xs",
          state === "error" ? "text-destructive" : state === "success" ? "text-success" : "text-muted-foreground",
        )}
        role="status"
      >
        {state === "error" && failure ? failure : stateCopy(state)}
      </p>
    </div>
  );
}
