"use client";

import Link from "next/link";
import { CheckCircle2, Settings2, TriangleAlert, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
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
  const ready = status.ready;

  const repair = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/company/defaults", {
        method: "POST",
        headers: getCsrfHeader(),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !isCompanyDefaultsStatus(payload)) {
        const message = payload && typeof payload === "object" && "message" in payload ? String(payload.message) : null;
        throw new Error(message ?? "No se pudo reparar la configuracion.");
      }
      setStatus(payload);
      toast.success("Configuracion revisada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  if (status.preset === "UNSUPPORTED") {
    return (
      <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
        No hay una plantilla automatica para el pais de esta empresa.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        ready ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/70",
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            {ready ? <CheckCircle2 className="size-5 text-emerald-700" /> : <TriangleAlert className="size-5 text-amber-700" />}
            <p className="font-medium">{ready ? "Plantilla completa" : "Plantilla incompleta"}</p>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {ready
              ? `La empresa tiene aplicada la plantilla ${status.label} y puede operar con sus ajustes base.`
              : `Faltan ${status.missingCount} de ${status.totalCount} elementos de la plantilla ${status.label}.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!ready && canRepair ? (
            <Button disabled={loading} onClick={repair} type="button">
              <Wrench />
              {loading ? "Reparando..." : "Reparar automaticamente"}
            </Button>
          ) : null}
          {!ready && !canRepair ? (
            <Link className={buttonVariants({ variant: "outline" })} href="/settings/masters">
              <Settings2 />
              Revisar maestros
            </Link>
          ) : null}
        </div>
      </div>

      {!compact || !ready ? (
        <details className="mt-4 rounded-md border bg-background/70">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            {ready ? "Ver detalle de configuracion" : "Ver elementos pendientes"}
          </summary>
          <div className="grid gap-2 border-t p-3 md:grid-cols-2">
            {status.groups.map((group) => (
              <div className="rounded-md border bg-card p-3" key={group.key}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{group.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{group.description}</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      group.missingCount === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
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
                    {group.missingCount > 6 ? <li>{group.missingCount - 6} elementos mas</li> : null}
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
