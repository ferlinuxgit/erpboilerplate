"use client";

import { LockOpen } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, errorMessage, readApiError } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/number-input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";

/** Apertura de caja: fondo de efectivo con el que empieza el turno. */
export function OpenRegisterPanel({ registerId, registerName }: { registerId: string; registerName: string }) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function open(event: React.FormEvent) {
    event.preventDefault();
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
    <form className="mx-auto max-w-sm space-y-3 border border-window-shadow bg-card p-5 text-center" data-testid="pos-open-panel" onSubmit={open}>
      <LockOpen aria-hidden="true" className="mx-auto size-10 text-link" />
      <h2 className="font-mono text-lg font-bold">Abrir {registerName}</h2>
      <p className="text-sm text-muted-foreground">Cuenta el efectivo que hay en el cajón para empezar (el cambio).</p>
      <AccessibleField id="pos-opening-cash" label="Fondo de caja">
        <MoneyInput autoFocus onChange={(event) => setOpeningCash(event.target.value)} placeholder="0,00" value={openingCash} />
      </AccessibleField>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <Button className="w-full" data-testid="pos-open-submit" disabled={pending} size="lg" type="submit">{pending ? "Abriendo…" : "Abrir caja"}</Button>
    </form>
  );
}
