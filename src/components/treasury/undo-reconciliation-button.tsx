"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Deshace la conciliación de uno o varios movimientos (API de la mesa de conciliación). */
export async function undoReconciliationRequest(transactionIds: string[]) {
  const response = await fetch("/api/treasury/reconciliation/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify({ transactionIds }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudo deshacer la conciliación."));
  return (await response.json()) as { undone: string[]; failed: Array<{ transactionId: string; reason: string }> };
}

export function UndoReconciliationButton({ transactionId, size = "sm" }: { transactionId: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await undoReconciliationRequest([transactionId]);
      toast.success("Movimiento devuelto a «Pendiente de conciliar».", {
        description: "Los cobros o pagos creados al conciliarlo se han eliminado y vuelve a estar en «Pendiente de identificar».",
      });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo deshacer la conciliación.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size={size} type="button" variant="outline">Deshacer</Button>
      <Dialog
        description="El movimiento volverá a pendiente. Si al conciliarlo se registraron cobros o pagos nuevos, se eliminarán; los que ya existían solo se desvinculan."
        onClose={() => { if (!loading) setOpen(false); }}
        open={open}
        title="Deshacer conciliación"
      >
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button disabled={loading} onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
          <Button disabled={loading} onClick={() => void confirm()} type="button">{loading ? "Deshaciendo…" : "Deshacer"}</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
