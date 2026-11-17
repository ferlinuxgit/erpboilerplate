"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getCsrfHeader } from "@/lib/csrf-client";
import { cn } from "@/lib/utils";
import { salesVatTreatmentOptions } from "@/server/invoices/lifecycle";

/**
 * Tratamientos de IVA de las ventas como catálogo: cada uno con «Lo uso». Solo los marcados se
 * ofrecen al facturar. El nacional siempre se usa. «Automático» los deduce de lo que vendes.
 */
export function VatTreatmentsPanel({ initialAutomatic, initialEnabled }: { initialAutomatic: boolean; initialEnabled: string[] }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [automatic, setAutomatic] = useState(initialAutomatic);
  const [busy, setBusy] = useState(false);

  const save = async (treatments: string[] | null, success: string) => {
    const previous = enabled;
    // Las casillas cambian al momento; si no se guarda, vuelven a como estaban.
    if (treatments) setEnabled(treatments);
    setBusy(true);
    try {
      const response = await fetch("/api/settings/vat-treatments", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ treatments }),
      });
      const payload = (await response.json().catch(() => ({}))) as { enabled?: string[]; automatic?: boolean; message?: string };
      if (!response.ok || !payload.enabled) throw new Error(payload.message ?? "No se pudo guardar el cambio.");
      setEnabled(payload.enabled);
      setAutomatic(Boolean(payload.automatic));
      toast.success(success);
    } catch (error) {
      setEnabled(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (value: string, label: string, checked: boolean) =>
    void save(checked ? [...enabled, value] : enabled.filter((entry) => entry !== value), checked ? `«${label}» activado: ya aparece al facturar.` : `«${label}» desactivado.`);

  return (
    <div className="space-y-2" data-testid="vat-treatments">
      <p className="text-xs text-muted-foreground">
        Marca los que usas en tus ventas: solo esos aparecen al elegir el tratamiento de IVA de una factura.
        {automatic ? " Ahora se eligen solos según lo que vendes (productos, servicios o ambos)." : ""}
      </p>
      <ul className="divide-y divide-window-shadow rounded-surface border border-window-dark-shadow">
        {salesVatTreatmentOptions.map((option) => {
          const checked = enabled.includes(option.value);
          const locked = option.value === "DOMESTIC";
          return (
            <li className={cn("p-2.5", !checked && "bg-window-panel/40")} key={option.value}>
              <label className={cn("flex items-start gap-2", locked ? "cursor-default" : "cursor-pointer")}>
                <input
                  checked={checked}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  disabled={busy || locked}
                  onChange={(event) => toggle(option.value, option.label, event.target.checked)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-bold">
                    {option.label}
                    {locked ? <span className="ml-1 font-normal text-muted-foreground">(siempre)</span> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{option.help}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {!automatic ? (
        <Button disabled={busy} onClick={() => void save(null, "Tratamientos de IVA automáticos según lo que vendes.")} size="sm" type="button" variant="ghost">
          Volver a los automáticos
        </Button>
      ) : null}
    </div>
  );
}
