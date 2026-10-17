"use client";

import { LockOpen } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormErrorMessage, errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";

import { AmountPad } from "./amount-pad";

/** Apertura de caja: fondo de efectivo con el que empieza el turno (teclado táctil). */
export function OpenRegisterPanel({ registerId, registerName }: { registerId: string; registerName: string }) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function open() {
    const amount = openingCash.trim() ? parseDecimalInput(openingCash, { maximumFractionDigits: 2 }) : 0;
    if (amount === null || amount < 0) {
      setError("Importe no válido.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos/registers/${registerId}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ openingCash: amount }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo abrir la caja."));
      toast.success(`${registerName} abierta.`);
      router.refresh();
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo abrir la caja."));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-4 p-4" data-testid="pos-open-panel">
      <div className="text-center">
        <LockOpen aria-hidden="true" className="mx-auto size-12 text-link" />
        <h1 className="mt-2 font-mono text-xl font-bold">Abrir {registerName}</h1>
        <p className="text-sm text-muted-foreground">Cuenta el efectivo que hay en el cajón para empezar (el cambio).</p>
      </div>
      <AmountPad autoFocus id="pos-opening-cash" label="Fondo de caja" onChange={setOpeningCash} onEnter={() => void open()} value={openingCash} />
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <Button className="h-16 w-full text-xl" data-testid="pos-open-submit" disabled={pending} onClick={() => void open()} type="button">{pending ? "Abriendo…" : "Abrir caja"}</Button>
    </div>
  );
}
