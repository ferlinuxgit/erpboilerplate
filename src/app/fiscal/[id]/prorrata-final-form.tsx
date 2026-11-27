"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

type ProrrataFinalFormProps = {
  year: number;
  /** Porcentaje calculado con las operaciones del año (propuesta); null si no hubo operaciones. */
  computedPct: number | null;
  /** Porcentaje ya confirmado; null si todavía no. */
  confirmedPct: number | null;
};

/**
 * Confirmar o corregir la prorrata definitiva del ejercicio. Hasta que se confirma, el modelo no
 * incluye la regularización (casillas 43 y 44).
 */
export function ProrrataFinalForm({ computedPct, confirmedPct, year }: ProrrataFinalFormProps) {
  const router = useRouter();
  const [value, setValue] = useState(String(confirmedPct ?? computedPct ?? ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function save(pct: number | null) {
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/fiscal/prorrata", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ year, pct }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la prorrata definitiva."));
      toast.success(pct === null ? `Prorrata definitiva de ${year} retirada: el modelo vuelve a calcularse sin regularización.` : `Prorrata definitiva de ${year} confirmada: ${pct} %.`);
      router.refresh();
    } catch (saveError) {
      const message = errorMessage(saveError, "No se pudo guardar la prorrata definitiva.");
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const pct = Number(value.replace(",", "."));
    if (value.trim() === "" || !Number.isInteger(pct) || pct < 0 || pct > 100) {
      setError("Escribe un porcentaje entero entre 0 y 100 (la prorrata se redondea siempre a la unidad superior).");
      return;
    }
    void save(pct);
  }

  return (
    <form className="flex flex-wrap items-end gap-3" noValidate onSubmit={submit}>
      <AccessibleField
        className="w-full sm:w-56"
        error={error}
        helperText={computedPct === null ? "No hay operaciones en el año para calcularla." : `Calculada con tus facturas del año: ${computedPct} %.`}
        id={`prorrata-final-${year}`}
        label={`Prorrata definitiva de ${year} (%)`}
        required
      >
        <Input inputMode="numeric" max={100} min={0} onChange={(event) => setValue(event.target.value)} step={1} type="number" value={value} />
      </AccessibleField>
      <Button disabled={submitting} type="submit">{confirmedPct === null ? "Confirmar porcentaje" : "Cambiar porcentaje"}</Button>
      {confirmedPct !== null ? (
        <Button disabled={submitting} onClick={() => void save(null)} type="button" variant="outline">Quitar confirmación</Button>
      ) : null}
    </form>
  );
}
