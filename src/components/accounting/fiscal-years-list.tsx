"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";

type FiscalYearItem = { id: string; code: string; startsAt: string; endsAt: string; isClosed: boolean };

/** Ejercicios de la empresa: periodo, estado y cuál está en uso (se puede cambiar desde aquí). */
export function FiscalYearsList({ activeYearId, companyId, years }: { activeYearId: string; companyId: string; years: FiscalYearItem[] }) {
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);

  async function use(year: FiscalYearItem) {
    setSwitching(year.id);
    try {
      const response = await fetch("/api/context/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ companyId, fiscalYearId: year.id }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar de ejercicio."));
      invalidateActiveContext();
      toast.success(`Ahora trabajas en el ejercicio ${year.code}.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo cambiar de ejercicio."));
    } finally {
      setSwitching(null);
    }
  }

  if (years.length === 0) return <p className="text-sm text-muted-foreground">La empresa todavía no tiene ejercicios.</p>;

  return (
    <ul aria-label="Ejercicios fiscales" className="divide-y divide-window-shadow border border-window-shadow bg-card">
      {[...years].reverse().map((year) => {
        const active = year.id === activeYearId;
        return (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5" key={year.id}>
            <span className="w-16 font-mono text-sm font-bold">{year.code}</span>
            <span className="text-xs text-muted-foreground">{formatDate(year.startsAt)} – {formatDate(year.endsAt)}</span>
            <StatusBadge tone={year.isClosed ? "neutral" : "success"}>{year.isClosed ? "Cerrado" : "Abierto"}</StatusBadge>
            <span className="ml-auto">
              {active ? (
                <StatusBadge tone="info">En uso</StatusBadge>
              ) : (
                <Button aria-busy={switching === year.id || undefined} disabled={switching !== null} onClick={() => void use(year)} size="sm" type="button" variant="outline">
                  {switching === year.id ? "Cambiando…" : <>Usar {year.code}</>}
                </Button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
