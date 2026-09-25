"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDateTime } from "@/lib/format";

export type ViesSnapshot = {
  status: "VALID" | "INVALID" | "UNAVAILABLE" | string | null;
  name?: string | null;
  checkedAt: Date | string | null;
};

const statusCopy: Record<string, { label: string; tone: "success" | "danger" | "warning" }> = {
  VALID: { label: "NIF-IVA válido en VIES", tone: "success" },
  INVALID: { label: "NIF-IVA no válido en VIES", tone: "danger" },
  UNAVAILABLE: { label: "VIES no disponible", tone: "warning" },
};

/**
 * Comprobación del NIF-IVA intracomunitario en VIES (UE). Sin un NIF-IVA válido no se puede
 * facturar sin IVA a una empresa de otro país de la UE.
 */
export function ViesCheck({ customerId, initial }: { customerId: string; initial: ViesSnapshot | null }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ViesSnapshot | null>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = snapshot?.status ? statusCopy[snapshot.status] : null;

  async function check() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/customers/${customerId}/vies`, { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() } });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo comprobar el NIF-IVA en VIES."));
      const result = (await response.json()) as { status: string; name: string | null; checkedAt: string; message: string };
      setSnapshot({ status: result.status, name: result.name, checkedAt: result.checkedAt });
      setMessage(result.message);
      if (result.status === "VALID") toast.success(result.message);
      else if (result.status === "INVALID") toast.error(result.message);
      else toast.warning(result.message);
      router.refresh();
    } catch (error) {
      const text = errorMessage(error, "No se pudo comprobar el NIF-IVA en VIES.");
      setMessage(text);
      toast.error(text);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-sm" data-testid="customer-vies-check">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">Comprobación intracomunitaria (VIES)</p>
        {copy ? (
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={copy.tone}>{copy.label}</StatusBadge>
            {snapshot?.name ? <span className="text-xs">{snapshot.name}</span> : null}
            {snapshot?.checkedAt ? <span className="text-xs text-muted-foreground">Comprobado el {formatDateTime(snapshot.checkedAt)}</span> : null}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Sin comprobar. Para vender sin IVA a una empresa de la UE su NIF-IVA debe ser válido en VIES.</p>
        )}
        {message ? <p className="text-xs" role="status">{message}</p> : null}
      </div>
      <SubmitButton data-testid="customer-vies-check-button" onClick={() => void check()} pending={pending} pendingLabel="Comprobando…" size="sm" type="button" variant="outline">
        Comprobar en VIES
      </SubmitButton>
    </div>
  );
}
