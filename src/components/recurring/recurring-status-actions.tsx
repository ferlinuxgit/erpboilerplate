"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Pausar / reanudar y borrar una recurrencia. */
export function RecurringStatusActions({
  afterDeleteHref,
  id,
  name,
  size = "default",
  status,
}: {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "FINISHED";
  afterDeleteHref?: string;
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function setStatus(next: "ACTIVE" | "PAUSED") {
    setPending(true);
    try {
      const response = await fetch(`/api/recurring/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar el estado."));
      toast.success(next === "PAUSED" ? `«${name}» en pausa: no se generará nada hasta que la reanudes.` : `«${name}» reanudada.`);
      router.refresh();
    } catch (statusError) {
      toast.error(errorMessage(statusError, "No se pudo cambiar el estado."));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/recurring/${id}`, { method: "DELETE", headers: getCsrfHeader() });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo borrar."));
      toast.success(`«${name}» borrada.`);
      setConfirmDelete(false);
      if (afterDeleteHref) router.push(afterDeleteHref);
      router.refresh();
    } catch (deleteError) {
      toast.error(errorMessage(deleteError, "No se pudo borrar."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {status === "ACTIVE" ? (
        <SubmitButton onClick={() => void setStatus("PAUSED")} pending={pending} pendingLabel="Pausando…" size={size} type="button" variant="outline">Pausar</SubmitButton>
      ) : null}
      {status === "PAUSED" ? (
        <SubmitButton onClick={() => void setStatus("ACTIVE")} pending={pending} pendingLabel="Reanudando…" size={size} type="button" variant="outline">Reanudar</SubmitButton>
      ) : null}
      <Button onClick={() => setConfirmDelete(true)} size={size} type="button" variant="outline">Borrar</Button>
      <DestructiveActionDialog
        confirmLabel="Borrar recurrencia"
        description={`Se borrará «${name}» y su historial. Las facturas y gastos ya generados no se tocan.`}
        isSubmitting={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        open={confirmDelete}
        title={`¿Borrar «${name}»?`}
      />
    </div>
  );
}
