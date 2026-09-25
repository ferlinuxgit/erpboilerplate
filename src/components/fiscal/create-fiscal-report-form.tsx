"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import {
  composeFiscalPeriod,
  fiscalPeriodPartsFor,
  spanishFiscalModels,
  splitFiscalPeriod,
  type SpanishFiscalModel,
  type SpanishFiscalModelCode,
} from "@/lib/fiscal-spain";

type CreateFiscalReportFormProps = {
  onCancel?: () => void;
  /** Recibe el modelo creado. Si no se indica, se abre su ficha (/fiscal/{id}). */
  onSuccess?: (created: { id: string }) => void;
  /** Destino tras crear; por defecto la ficha del modelo recién creado. */
  redirectHref?: string;
  /** Modelos disponibles (p. ej. sin el 130 si la empresa es una sociedad). */
  models?: SpanishFiscalModel[];
  initialCode?: string;
  initialPeriod?: string;
  /** Periodicidad del IVA de la empresa: decide si se propone trimestre o mes. */
  periodicity?: "monthly" | "quarterly";
  /** Fecha de referencia para proponer el periodo (por defecto, hoy). */
  today?: Date;
};

/** Periodo propuesto: el último cerrado (trimestre o mes anterior) o el año anterior para los anuales. */
function suggestedPeriod(code: SpanishFiscalModelCode, periodicity: "monthly" | "quarterly", today: Date) {
  const parts = fiscalPeriodPartsFor(code);
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  if (parts.length === 0) return { year: year - 1, part: null };
  const monthly = periodicity === "monthly" && parts.some((part) => part.value === "01");
  if (monthly) return month === 1 ? { year: year - 1, part: "12" } : { year, part: String(month - 1).padStart(2, "0") };
  const quarter = Math.floor((month - 1) / 3) + 1;
  return quarter === 1 ? { year: year - 1, part: "Q4" } : { year, part: `Q${quarter - 1}` };
}

export function CreateFiscalReportForm({
  initialCode,
  initialPeriod,
  models = spanishFiscalModels,
  onCancel,
  onSuccess,
  periodicity = "quarterly",
  redirectHref,
  today,
}: CreateFiscalReportFormProps = {}) {
  const router = useRouter();
  const [referenceDate] = useState(() => today ?? new Date());
  const [code, setCode] = useState<SpanishFiscalModelCode>(() => {
    const requested = models.find((model) => model.code === initialCode);
    return requested?.code ?? models[0]?.code ?? "303";
  });
  const initial = splitFiscalPeriod(initialPeriod);
  const [year, setYear] = useState<number>(() => initial.year ?? suggestedPeriod(code, periodicity, referenceDate).year);
  const [part, setPart] = useState<string | null>(() => (initial.year ? initial.part : suggestedPeriod(code, periodicity, referenceDate).part));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedModel = models.find((model) => model.code === code);
  const parts = fiscalPeriodPartsFor(code);
  const quarterParts = parts.filter((option) => option.value.startsWith("Q"));
  const monthParts = parts.filter((option) => !option.value.startsWith("Q"));
  const currentYear = referenceDate.getFullYear();
  const years = [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
  const errorId = error ? "fiscal-report-error" : undefined;

  function changeCode(nextCode: SpanishFiscalModelCode) {
    setCode(nextCode);
    const nextParts = fiscalPeriodPartsFor(nextCode);
    // Conserva el subperiodo si sigue siendo válido para el nuevo modelo; si no, propone el habitual.
    if (!nextParts.some((option) => option.value === part)) {
      const suggestion = suggestedPeriod(nextCode, periodicity, referenceDate);
      setPart(suggestion.part);
      if (nextParts.length === 0) setYear(suggestion.year);
    }
  }

  return (
    <form className="grid gap-4 md:grid-cols-3" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const response = await fetch("/api/fiscal-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ code, period: composeFiscalPeriod(year, parts.length ? part : null), status: "DRAFT" }),
        });
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo crear el borrador del modelo."));
        const created = (await response.json().catch(() => null)) as { id?: string } | null;
        toast.success(`Borrador del ${selectedModel?.name ?? "modelo"} creado. Revisa las casillas antes de presentarlo.`);
        if (onSuccess && created?.id) {
          onSuccess({ id: created.id });
        } else if (redirectHref) {
          router.push(redirectHref);
        } else if (created?.id) {
          router.push(`/fiscal/${created.id}`);
        } else {
          router.refresh();
        }
      } catch (submissionError) {
        const message = errorMessage(submissionError, "No se pudo crear el borrador del modelo.");
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    }}>
      <div className="space-y-2">
        <Label htmlFor="fiscal-report-code">Modelo</Label>
        <Select
          id="fiscal-report-code"
          value={code}
          onChange={(e) => changeCode(e.target.value as SpanishFiscalModelCode)}
          required
          aria-describedby={["fiscal-report-code-help", errorId].filter(Boolean).join(" ")}
        >
          {models.map((model) => (
            <option key={model.code} value={model.code}>
              {model.name} - {model.shortName}
            </option>
          ))}
        </Select>
        {selectedModel ? <p className="text-xs text-muted-foreground" id="fiscal-report-code-help">{selectedModel.plainHelp}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="fiscal-report-year">Año</Label>
        <Select id="fiscal-report-year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} required aria-describedby={errorId}>
          {years.map((option) => <option key={option} value={option}>{option}</option>)}
        </Select>
      </div>
      {parts.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor="fiscal-report-period">{monthParts.length ? "Trimestre o mes" : "Trimestre"}</Label>
          <Select id="fiscal-report-period" value={part ?? ""} onChange={(e) => setPart(e.target.value)} required aria-describedby={errorId}>
            <optgroup label="Trimestres">
              {quarterParts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
            {monthParts.length ? (
              <optgroup label="Meses (solo si presentas el IVA mensualmente)">
                {monthParts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </optgroup>
            ) : null}
          </Select>
        </div>
      ) : (
        <p className="self-end text-xs text-muted-foreground">Modelo anual: se calcula con todo el año {year}.</p>
      )}
      <p className="text-xs text-muted-foreground md:col-span-3">
        Se crea como borrador. Cuando lo presentes en la sede de la AEAT, márcalo como presentado desde su ficha con la fecha y el número de justificante.
      </p>
      <div className="flex flex-col-reverse gap-2 md:col-span-3 sm:flex-row sm:justify-end">{onCancel ? <Button onClick={onCancel} type="button" variant="outline">Cancelar</Button> : null}<Button type="submit" disabled={loading}>{loading ? "Creando…" : "Crear borrador"}</Button></div>
      {error ? <InlineAlert id="fiscal-report-error" className="md:col-span-3" role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
