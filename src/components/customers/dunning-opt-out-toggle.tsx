"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Guarda la exclusión del cliente de los recordatorios de cobro (mismo dato que «Cobros pendientes»). */
export async function saveDunningOptOut(customerId: string, optOut: boolean) {
  const response = await fetch("/api/dunning/opt-out", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: JSON.stringify({ customerId, optOut }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la preferencia de recordatorios."));
}

export const DUNNING_OPT_OUT_LABEL = "No enviar recordatorios de cobro";
export const DUNNING_OPT_OUT_HELP = "No recibirá recordatorios de facturas vencidas, ni automáticos ni en bloque desde Cobros pendientes. Puedes seguir enviándole sus facturas.";

/** Casilla de la ficha del cliente: se guarda al marcarla o desmarcarla. */
export function DunningOptOutToggle({ customerId, customerName, initialOptedOut }: { customerId: string; customerName: string; initialOptedOut: boolean }) {
  const router = useRouter();
  const id = useId();
  const [optedOut, setOptedOut] = useState(initialOptedOut);
  const [pending, setPending] = useState(false);

  async function toggle(next: boolean) {
    setPending(true);
    setOptedOut(next);
    try {
      await saveDunningOptOut(customerId, next);
      toast.success(next ? `${customerName} no recibirá recordatorios de cobro.` : `${customerName} vuelve a recibir recordatorios de cobro.`);
      router.refresh();
    } catch (error) {
      setOptedOut(!next);
      toast.error(errorMessage(error, "No se pudo guardar la preferencia de recordatorios."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1" data-testid="customer-dunning-opt-out">
      <label className="flex items-center gap-2 font-mono text-xs font-bold" htmlFor={id}>
        <input
          aria-describedby={`${id}-help`}
          checked={optedOut}
          disabled={pending}
          id={id}
          type="checkbox"
          onChange={(event) => void toggle(event.target.checked)}
        />
        {DUNNING_OPT_OUT_LABEL}
      </label>
      <p className="text-xs text-muted-foreground" id={`${id}-help`}>{DUNNING_OPT_OUT_HELP}</p>
    </div>
  );
}
