"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";

type SalesTransitionButtonProps = {
  /** Texto del botón (p. ej. "Generar factura"). */
  label: string;
  url: string;
  method?: "POST" | "DELETE";
  body?: Record<string, unknown>;
  /** Tras completarse, se abre `${targetBasePath}/${id}` con el id devuelto (si lo hay). */
  targetBasePath?: string;
  /** Confirmación con el resultado concreto de la acción. */
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  /** Mensaje de éxito; "{number}" se sustituye por el número devuelto. */
  successMessage: string;
  variant?: "default" | "outline" | "secondary" | "destructive";
  testId?: string;
  showArrow?: boolean;
};

/**
 * Acción de un documento de venta (convertir, facturar, cambiar estado) con confirmación previa:
 * el usuario ve exactamente qué va a pasar antes de pulsar, y después un mensaje con el resultado.
 */
export function SalesTransitionButton({
  body,
  confirmDescription,
  confirmLabel,
  confirmTitle,
  label,
  method = "POST",
  showArrow = true,
  successMessage,
  targetBasePath,
  testId,
  url,
  variant = "default",
}: SalesTransitionButtonProps) {
  const router = useRouter();
  const cancelId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(body ?? {}),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar la acción."));
      const payload = (await response.json().catch(() => null)) as { id?: string; number?: string; message?: string } | null;
      setOpen(false);
      toast.success(successMessage.replace("{number}", payload?.number ?? ""));
      if (targetBasePath && payload?.id) router.push(`${targetBasePath}/${payload.id}`);
      router.refresh();
    } catch (runError) {
      const message = errorMessage(runError, "No se pudo completar la acción.");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button data-testid={testId} onClick={() => { setError(null); setOpen(true); }} type="button" variant={variant}>
        {label}
        {showArrow ? <ArrowRight aria-hidden="true" /> : null}
      </Button>
      <Dialog description={confirmDescription} initialFocusId={cancelId} onClose={() => { if (!loading) setOpen(false); }} open={open} size="sm" title={confirmTitle}>
        {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
        <DialogFooter>
          <Button disabled={loading} id={cancelId} onClick={() => setOpen(false)} type="button" variant="outline">
            Cancelar
          </Button>
          <SubmitButton data-testid={testId ? `${testId}-confirm` : "sales-transition-confirm"} onClick={() => void run()} pending={loading} pendingLabel="Procesando…" type="button" variant={variant === "destructive" ? "destructive" : "default"}>
            {confirmLabel}
          </SubmitButton>
        </DialogFooter>
      </Dialog>
    </>
  );
}
