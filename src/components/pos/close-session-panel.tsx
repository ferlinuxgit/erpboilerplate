"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, errorMessage, readApiError } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { countDenominations, EURO_DENOMINATIONS } from "@/modules/pos/model";

/** Cierre de caja: cuenta el efectivo (por billetes y monedas o el total) y compara con lo esperado. */
export function CloseSessionPanel({ currencyCode, expectedCash, sessionId }: { currencyCode: string; expectedCash: number; sessionId: string }) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [manual, setManual] = useState("");
  const [notes, setNotes] = useState("");
  const [postDifference, setPostDifference] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fromCounts = useMemo(() => countDenominations(Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number.parseInt(value, 10) || 0]))), [counts]);
  const usingCounts = Object.values(counts).some((value) => value.trim() !== "");
  const counted = usingCounts ? fromCounts : parseDecimalInput(manual, { maximumFractionDigits: 2 });
  const difference = counted === null ? null : Math.round((counted - expectedCash) * 100) / 100;

  async function close() {
    if (counted === null || counted < 0) {
      setError("Indica el efectivo contado.");
      return;
    }
    if (difference !== 0 && !window.confirm(`Hay una diferencia de ${formatMoney(difference ?? 0, currencyCode)}. ¿Cerrar la caja igualmente?`)) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos/sessions/${sessionId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ countedCash: counted, notes: notes || null, postDifference }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cerrar la caja."));
      toast.success("Caja cerrada.");
      router.push(`/pos/sessions/${sessionId}`);
      router.refresh();
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo cerrar la caja."));
      setPending(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="pos-close-panel">
      <details className="border border-window-shadow p-2">
        <summary className="cursor-pointer font-mono text-xs font-bold">Contar por billetes y monedas</summary>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {EURO_DENOMINATIONS.map((denomination) => (
            <label className="grid gap-0.5 text-[11px] font-medium" key={denomination}>
              {formatMoney(denomination, currencyCode)}
              <input className="h-8 border border-window-dark-shadow bg-window-panel px-1 text-right font-mono" inputMode="numeric" onChange={(event) => setCounts((current) => ({ ...current, [String(denomination)]: event.target.value.replace(/\D/g, "") }))} value={counts[String(denomination)] ?? ""} />
            </label>
          ))}
        </div>
        <p className="mt-2 text-right font-mono text-sm">Total contado: <strong>{formatMoney(fromCounts, currencyCode)}</strong></p>
      </details>
      {!usingCounts ? (
        <AccessibleField id="pos-counted-cash" label="Efectivo contado">
          <MoneyInput autoFocus onChange={(event) => setManual(event.target.value)} value={manual} />
        </AccessibleField>
      ) : null}
      <div className="flex items-center justify-between border border-window-shadow bg-window-panel p-2 font-mono">
        <span>Esperado {formatMoney(expectedCash, currencyCode)}</span>
        <span className={difference === null ? "" : difference === 0 ? "font-bold text-success-text" : "font-bold text-destructive"} data-testid="pos-close-difference">
          {difference === null ? "—" : difference === 0 ? "Cuadra" : `${difference > 0 ? "Sobran" : "Faltan"} ${formatMoney(Math.abs(difference), currencyCode)}`}
        </span>
      </div>
      {difference !== null && difference !== 0 ? (
        <label className="flex items-start gap-2 text-sm" htmlFor="pos-post-difference">
          <input checked={postDifference} className="mt-0.5" id="pos-post-difference" onChange={(event) => setPostDifference(event.target.checked)} type="checkbox" />
          <span>Contabilizar la diferencia de caja <span className="text-xs text-muted-foreground">({difference < 0 ? "faltante: 678 a 570" : "sobrante: 570 a 778"}). Desmárcalo si vas a buscar el error.</span></span>
        </label>
      ) : null}
      <AccessibleField id="pos-close-notes" label="Notas del cierre (opcional)"><Textarea onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} /></AccessibleField>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <Button className="w-full" data-testid="pos-close-submit" disabled={pending} size="lg" type="button" onClick={() => void close()}>{pending ? "Cerrando…" : "Cerrar caja"}</Button>
    </div>
  );
}
