"use client";

import Link from "next/link";
import { CheckCircle as CheckCircle2, GearSix as Settings2, Warning as TriangleAlert, Wrench } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";
import { cn } from "@/lib/utils";
import type { CompanyDefaultsStatus } from "@/server/company/defaults";

type CompanyDefaultsPanelProps = {
  initialStatus: CompanyDefaultsStatus;
  canRepair?: boolean;
  compact?: boolean;
};

function isCompanyDefaultsStatus(value: unknown): value is CompanyDefaultsStatus {
  return Boolean(value && typeof value === "object" && "ready" in value && "groups" in value);
}

export function CompanyDefaultsPanel({ canRepair = true, compact = false, initialStatus }: CompanyDefaultsPanelProps) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const ready = status.ready;

  const repair = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setFormError(null);
    try {
      const response = await fetch("/api/company/defaults", {
        method: "POST",
        headers: getCsrfHeader(),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo reparar la configuración."));
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!isCompanyDefaultsStatus(payload)) throw new Error("La respuesta del servidor no es válida. Recarga la página e inténtalo de nuevo.");
      setStatus(payload);
      toast.success(payload.ready ? "Plantilla reparada: la configuración base está completa." : "Configuración revisada. Aún quedan elementos pendientes.");
    } catch (error) {
      const message = errorMessage(error, "No se pudo reparar la configuración.");
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (status.preset === "UNSUPPORTED") {
    return (
      <div className="border border-dashed border-window-dark-shadow bg-window-panel p-3 text-xs text-muted-foreground">
        No hay una plantilla automática para el país de esta empresa. Revisa los maestros y el plan contable manualmente.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border p-3 shadow-[inset_1px_1px_0_var(--window-highlight)]",
        ready ? "border-success bg-success/10" : "border-warning bg-warning/10",
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            {ready ? <CheckCircle2 aria-hidden="true" className="size-5 text-success" /> : <TriangleAlert aria-hidden="true" className="size-5 text-warning" />}
            <p className="font-mono text-sm font-bold">{ready ? "Plantilla completa" : "Plantilla incompleta"}</p>
          </div>
          <p className="max-w-3xl text-xs text-muted-foreground">
            {ready
              ? `La empresa tiene aplicada la plantilla ${status.label} y puede operar con sus ajustes base.`
              : `Faltan ${status.missingCount} de ${status.totalCount} elementos de la plantilla ${status.label}.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!ready && canRepair ? (
            <form className="space-y-2" onSubmit={repair}>
              <SubmitButton pending={loading} pendingLabel="Reparando…">
                <Wrench aria-hidden="true" />
                Reparar automáticamente
              </SubmitButton>
              <FormErrorMessage>{formError}</FormErrorMessage>
            </form>
          ) : null}
          {!ready && !canRepair ? (
            <Link className={buttonVariants({ variant: "outline" })} href="/settings/masters">
              <Settings2 aria-hidden="true" />
              Revisar maestros
            </Link>
          ) : null}
        </div>
      </div>

      {!compact || !ready ? (
        <details className="mt-4 border border-window-dark-shadow bg-window-panel">
          <summary className="cursor-pointer px-3 py-2 font-mono text-xs font-bold">
            {ready ? "Ver detalle de configuración" : "Ver elementos pendientes"}
          </summary>
          <div className="grid gap-2 border-t border-window-shadow p-3 md:grid-cols-2">
            {status.groups.map((group) => (
              <div className="border border-window-shadow bg-card p-3" key={group.key}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-bold">{group.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{group.description}</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-[1px] border px-2 py-0.5 font-mono text-xs font-bold tabular-nums",
                      group.missingCount === 0 ? "border-success bg-success/15 text-success" : "border-warning bg-warning/15 text-warning",
                    )}
                  >
                    {group.totalCount - group.missingCount}/{group.totalCount}
                  </span>
                </div>
                {group.missingCount > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {group.items
                      .filter((item) => !item.created)
                      .slice(0, 6)
                      .map((item) => (
                        <li className="truncate" key={item.key}>
                          {item.label}
                        </li>
                      ))}
                    {group.missingCount > 6 ? <li>{group.missingCount - 6} elementos más</li> : null}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
