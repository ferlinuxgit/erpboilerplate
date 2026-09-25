"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

type Action = "confirm" | "unconfirm" | "cancel";

const copy: Record<Action, { title: string; description: string; button: string; done: string }> = {
  confirm: {
    title: "Marcar remesa como enviada",
    description: "Confirma que has subido el fichero al banco y que va a cargar (o ya ha cargado) los pagos. Se registrará un pago por factura con la fecha de ejecución y las facturas quedarán pagadas.",
    button: "Remesa enviada / cargada",
    done: "Pagos registrados. Cuando el cargo aparezca en el extracto, concílialo con la propuesta «Remesa SEPA».",
  },
  unconfirm: {
    title: "Deshacer la confirmación",
    description: "Se eliminarán los pagos registrados por esta remesa y las facturas volverán a estar pendientes. Solo es posible si ninguno está conciliado con el banco.",
    button: "Deshacer confirmación",
    done: "Pagos eliminados: la remesa vuelve a estar pendiente de confirmar.",
  },
  cancel: {
    title: "Descartar remesa",
    description: "La remesa quedará descartada y sus facturas podrán incluirse en otra. No borra nada en el banco: si ya subiste el fichero, anúlalo también allí.",
    button: "Descartar remesa",
    done: "Remesa descartada.",
  },
};

export function RemittanceActions({ id, number, status }: { id: string; number: string; status: string }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/sepa/remittances/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo actualizar la remesa."));
      toast.success(copy[action].done);
      setAction(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar la remesa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "CANCELLED" ? (
        <a className={buttonVariants({ variant: status === "GENERATED" ? "default" : "outline" })} download={`remesa-${number}.xml`} href={`/api/sepa/remittances/${id}?download=xml`}>
          Descargar fichero SEPA
        </a>
      ) : null}
      {status === "GENERATED" ? (
        <>
          <Button data-testid="remittance-confirm" onClick={() => { setError(null); setAction("confirm"); }} type="button" variant="outline">{copy.confirm.button}</Button>
          <Button onClick={() => { setError(null); setAction("cancel"); }} type="button" variant="ghost">{copy.cancel.button}</Button>
        </>
      ) : null}
      {status === "CONFIRMED" ? <Button onClick={() => { setError(null); setAction("unconfirm"); }} type="button" variant="outline">{copy.unconfirm.button}</Button> : null}
      {action ? (
        <Dialog description={copy[action].description} onClose={() => { if (!busy) setAction(null); }} open title={copy[action].title}>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button disabled={busy} onClick={() => setAction(null)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={busy} onClick={() => void run()} type="button">{busy ? "Guardando…" : copy[action].button}</Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
