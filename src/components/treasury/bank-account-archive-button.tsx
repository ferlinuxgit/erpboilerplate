"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Archiva o reactiva una cuenta bancaria. Archivar conserva movimientos y asientos; solo impide registrar nuevos. */
export function BankAccountArchiveButton({ accountId, bankName, isActive }: { accountId: string; bankName: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      const response = await fetch(`/api/bank-accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ archived: isActive }),
      });
      if (!response.ok) throw new Error(await readApiError(response, isActive ? "No se pudo archivar la cuenta." : "No se pudo reactivar la cuenta."));
      toast.success(isActive ? `Cuenta ${bankName} archivada.` : `Cuenta ${bankName} reactivada.`, {
        description: isActive ? "Su historial se conserva; ya no admite movimientos nuevos." : "Ya puedes registrar movimientos en ella.",
      });
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught, "No se pudo actualizar la cuenta."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      aria-busy={pending}
      disabled={pending}
      onClick={() => void toggle()}
      size="sm"
      title={isActive ? "Oculta la cuenta para nuevos movimientos sin borrar su historial" : "Vuelve a permitir movimientos en esta cuenta"}
      type="button"
      variant="outline"
    >
      {pending ? "Guardando…" : isActive ? "Archivar" : "Reactivar"}
    </Button>
  );
}
