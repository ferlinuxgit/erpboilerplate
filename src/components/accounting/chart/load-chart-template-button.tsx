"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Estado vacío del plan contable: aplica la plantilla de la empresa (PGC en España) con la reparación de ajustes base. */
export function LoadChartTemplateButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col items-center gap-1"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch("/api/company/defaults", { method: "POST", headers: getCsrfHeader() });
          if (!response.ok) throw new Error(await readApiError(response, "No se pudo cargar la plantilla contable."));
          toast.success("Plantilla del PGC cargada.");
          router.refresh();
        } catch (submitError) {
          setError(errorMessage(submitError, "No se pudo cargar la plantilla contable."));
        } finally {
          setPending(false);
        }
      }}
    >
      <SubmitButton pending={pending} pendingLabel="Cargando plantilla…">Cargar plantilla PGC</SubmitButton>
      {error ? <p className="text-xs text-danger-text" role="alert">{error}</p> : null}
    </form>
  );
}
