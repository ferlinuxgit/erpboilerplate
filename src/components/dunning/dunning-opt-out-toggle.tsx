"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Excluir / volver a incluir a un cliente en los recordatorios de cobro (opción de menú). */
export function DunningOptOutMenuItem({ customerId, customerName, optedOut }: { customerId: string; customerName: string; optedOut: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      const response = await fetch("/api/dunning/opt-out", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ customerId, optOut: !optedOut }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la preferencia."));
      toast.success(optedOut ? `${customerName} vuelve a recibir recordatorios.` : `${customerName} no recibirá más recordatorios de cobro.`);
      router.refresh();
    } catch (toggleError) {
      toast.error(errorMessage(toggleError, "No se pudo guardar la preferencia."));
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenuItem disabled={pending} onClick={() => void toggle()}>
      {optedOut ? "Volver a enviar recordatorios a este cliente" : "No enviar recordatorios a este cliente"}
    </DropdownMenuItem>
  );
}
