"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type ExportState = "idle" | "loading" | "success" | "error";

function stateCopy(state: ExportState) {
  switch (state) {
    case "loading":
      return "Preparando exportación...";
    case "success":
      return "Excel listo para descargar.";
    case "error":
      return "No se pudo generar el Excel. Reinténtalo.";
    default:
      return "Exporta los KPIs visibles en un Excel para compartir con dirección.";
  }
}

export function ReportingExportButton() {
  const [state, setState] = useState<ExportState>("idle");

  async function handleExport() {
    setState("loading");

    try {
      const response = await fetch("/api/reporting/export");
      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "kpis.xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState("success");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-2">
      <Button disabled={state === "loading"} onClick={handleExport} type="button" variant="secondary">
        {state === "loading" ? "Preparando Excel..." : "Exportar KPIs a Excel"}
      </Button>
      <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
        {stateCopy(state)}
      </p>
    </div>
  );
}
