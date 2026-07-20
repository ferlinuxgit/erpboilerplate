"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney } from "@/lib/format";

type Candidate = { id: string; number: string; counterparty: string; amount: string; postedAt: Date | string };

export function ManualReconcileButton({ currencyCode = "EUR", reconciled, transactionId }: { currencyCode?: string; reconciled: boolean; transactionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"customer" | "supplier">("customer");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    if (reconciled) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/treasury/reconcile?transactionId=${encodeURIComponent(transactionId)}`);
      const payload = (await response.json().catch(() => null)) as { kind?: "customer" | "supplier"; candidates?: Candidate[]; message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "No se pudieron cargar las contrapartidas.");
      const nextCandidates = payload?.candidates ?? [];
      setKind(payload?.kind ?? "customer");
      setCandidates(nextCandidates);
      setSelectedId(nextCandidates[0]?.id ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar las contrapartidas.");
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/treasury/reconcile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(reconciled ? { action: "unmatch", transactionId } : { action: "match", transactionId, kind, matchId: selectedId }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "No se pudo actualizar la conciliación.");
      toast.success(reconciled ? "Movimiento devuelto a pendientes." : "Movimiento conciliado manualmente.");
      setOpen(false);
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo actualizar la conciliación.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => void openDialog()} size="sm" type="button" variant="outline">{reconciled ? "Desconciliar" : "Conciliar"}</Button>
      <Dialog
        description={reconciled ? "La contrapartida quedará libre y el movimiento volverá a pendientes para poder corregirlo." : "Selecciona un cobro o pago del mismo importe que todavía no esté conciliado."}
        onClose={() => { if (!loading) setOpen(false); }}
        open={open}
        title={reconciled ? "Desconciliar movimiento" : "Conciliación manual"}
      >
        {!reconciled ? (
          <div className="space-y-2">
            {loading && candidates.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Buscando contrapartidas…</p> : null}
            {!loading && candidates.length === 0 && !error ? <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No hay {kind === "customer" ? "cobros" : "pagos"} libres con el mismo importe. Revisa que el pago esté registrado.</p> : null}
            {candidates.map((candidate) => (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5" key={candidate.id}>
                <input checked={selectedId === candidate.id} className="mt-1" name={`reconcile-${transactionId}`} onChange={() => setSelectedId(candidate.id)} type="radio" />
                <span className="min-w-0 flex-1"><span className="block font-medium">{candidate.number} · {candidate.counterparty}</span><span className="mt-1 block text-sm text-muted-foreground">{formatDate(candidate.postedAt)} · {formatMoney(candidate.amount, currencyCode)}</span></span>
              </label>
            ))}
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button disabled={loading} onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
          <Button disabled={loading || (!reconciled && !selectedId)} onClick={confirm} type="button">{loading ? "Guardando…" : reconciled ? "Confirmar" : "Conciliar selección"}</Button>
        </div>
      </Dialog>
    </>
  );
}
