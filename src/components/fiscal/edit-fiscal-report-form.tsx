"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import {
  composeFiscalPeriod,
  fiscalPeriodPartsFor,
  fiscalStatusLabels,
  isSpanishFiscalModelCode,
  spanishFiscalModels,
  splitFiscalPeriod,
  type SpanishFiscalModelCode,
} from "@/lib/fiscal-spain";

type Status = "DRAFT" | "READY" | "FILED";

const REOPEN_REASON_MIN = 3;

export function EditFiscalReportForm({
  id,
  defaultCode,
  defaultPeriod,
  defaultStatus,
  onCancel,
  onSuccess,
}: {
  id: string;
  defaultCode: string;
  defaultPeriod: string;
  defaultStatus: Status;
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState<SpanishFiscalModelCode>(isSpanishFiscalModelCode(defaultCode) ? defaultCode : "303");
  const initial = splitFiscalPeriod(defaultPeriod);
  const [year, setYear] = useState<number>(initial.year ?? new Date().getFullYear());
  const [part, setPart] = useState<string | null>(initial.part);
  // "Presentado" solo se muestra si ya lo está (para poder reabrirlo); se marca con el diálogo de la ficha.
  const statuses: Status[] = defaultStatus === "FILED" ? ["FILED", "READY", "DRAFT"] : ["DRAFT", "READY"];
  const [status, setStatus] = useState<Status>(defaultStatus);
  const [reopenReason, setReopenReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parts = fiscalPeriodPartsFor(code);
  const reopening = defaultStatus === "FILED" && status !== "FILED";
  const currentYear = new Date().getFullYear();
  const years = [...new Set([currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear, currentYear + 1, year])].sort();
  const errorId = error ? "edit-fiscal-report-error" : undefined;

  function changeCode(nextCode: SpanishFiscalModelCode) {
    setCode(nextCode);
    const nextParts = fiscalPeriodPartsFor(nextCode);
    if (nextParts.length === 0) setPart(null);
    else if (!nextParts.some((option) => option.value === part)) setPart(nextParts[0].value);
  }

  return (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (reopening && reopenReason.trim().length < REOPEN_REASON_MIN) {
        setError("Indica el motivo para reabrir una declaración presentada.");
        return;
      }
      setError(null);
      setLoading(true);
      try {
        const response = await fetch(`/api/fiscal-reports/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({
            code,
            period: composeFiscalPeriod(year, parts.length ? part : null),
            status,
            ...(reopening ? { reopenReason: reopenReason.trim() } : {}),
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el modelo."));
        toast.success(reopening ? "Modelo reabierto. El periodo vuelve a admitir cambios." : "Modelo guardado.");
        if (onSuccess) onSuccess();
        else { router.push(`/fiscal/${id}`); router.refresh(); }
      } catch (submissionError) {
        const message = errorMessage(submissionError, "No se pudo guardar el modelo.");
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    }}>
      <div className="space-y-2">
        <Label htmlFor="edit-fiscal-report-code">Modelo</Label>
        <Select
          id="edit-fiscal-report-code"
          value={code}
          onChange={(e) => changeCode(e.target.value as SpanishFiscalModelCode)}
          required
          aria-describedby={errorId}
        >
          {spanishFiscalModels.map((model) => (
            <option key={model.code} value={model.code}>
              {model.name} - {model.shortName}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-fiscal-report-year">Año</Label>
          <Select id="edit-fiscal-report-year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} required aria-describedby={errorId}>
            {years.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </div>
        {parts.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="edit-fiscal-report-period">Trimestre o mes</Label>
            <Select id="edit-fiscal-report-period" value={part ?? parts[0].value} onChange={(e) => setPart(e.target.value)} required aria-describedby={errorId}>
              {parts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-fiscal-report-status">Estado</Label>
        <Select
          id="edit-fiscal-report-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          aria-describedby={["edit-fiscal-report-status-help", errorId].filter(Boolean).join(" ")}
        >
          {statuses.map((option) => <option key={option} value={option}>{fiscalStatusLabels[option]}</option>)}
        </Select>
        <p className="text-xs text-muted-foreground" id="edit-fiscal-report-status-help">
          Para marcarlo como presentado usa «Marcar como presentado» en la ficha del modelo (pide la fecha y el justificante).
        </p>
      </div>
      {reopening ? (
        <div className="space-y-2">
          <Label htmlFor="edit-fiscal-report-reopen-reason">Motivo de la reapertura</Label>
          <Textarea
            id="edit-fiscal-report-reopen-reason"
            maxLength={500}
            onChange={(event) => setReopenReason(event.target.value)}
            placeholder="Ej.: declaración complementaria por una factura olvidada"
            required
            rows={2}
            value={reopenReason}
          />
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{onCancel ? <Button onClick={onCancel} type="button" variant="outline">Cancelar</Button> : null}<Button type="submit" disabled={loading}>{loading ? "Guardando…" : "Guardar cambios"}</Button></div>
      {error ? <InlineAlert id="edit-fiscal-report-error" role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
