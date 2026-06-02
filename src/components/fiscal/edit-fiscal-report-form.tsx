"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";
import { spanishFiscalModels } from "@/lib/fiscal-spain";

const statuses = ["DRAFT", "READY", "FILED"] as const;

export function EditFiscalReportForm({
  id,
  defaultCode,
  defaultPeriod,
  defaultStatus,
}: {
  id: string;
  defaultCode: string;
  defaultPeriod: string;
  defaultStatus: (typeof statuses)[number];
}) {
  const router = useRouter();
  const [code, setCode] = useState(defaultCode);
  const [period, setPeriod] = useState(defaultPeriod);
  const [status, setStatus] = useState<(typeof statuses)[number]>(defaultStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error ? "edit-fiscal-report-error" : undefined;

  return (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const response = await fetch(`/api/fiscal-reports/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ code, period, status }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message ?? "No se pudo actualizar el reporte fiscal.");
        }
        toast.success("Reporte fiscal actualizado correctamente.");
        router.push("/fiscal");
        router.refresh();
      } catch (submissionError) {
        const message = submissionError instanceof Error ? submissionError.message : "Error inesperado.";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    }}>
      <div className="space-y-2">
        <Label htmlFor="edit-fiscal-report-code">Modelo</Label>
        <select
          className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
          id="edit-fiscal-report-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          aria-describedby={errorId}
        >
          {spanishFiscalModels.map((model) => (
            <option key={model.code} value={model.code}>
              {model.name} - {model.shortName}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-fiscal-report-period">Periodo</Label>
        <Input
          id="edit-fiscal-report-period"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder={spanishFiscalModels.find((model) => model.code === code)?.periodHint ?? "2026-Q1"}
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-fiscal-report-status">Estado</Label>
        <select
          id="edit-fiscal-report-status"
          className="h-8 rounded-md border px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof statuses)[number])}
          aria-describedby={errorId}
        >
          {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar cambios"}</Button>
      {error ? <p id="edit-fiscal-report-error" className="text-sm text-red-600" role="alert">{error}</p> : null}
    </form>
  );
}
