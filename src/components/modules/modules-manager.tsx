"use client";

import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { errorMessage, readApiError } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { getCsrfHeader } from "@/lib/csrf-client";
import { cn } from "@/lib/utils";
import { getModule, MODULES, type ModuleCategory, type ModuleId } from "@/modules/registry";

import { ModuleIcon } from "./module-icon";

export type ModuleStateView = { id: ModuleId; enabled: boolean; explicit: boolean };

const CATEGORIES: ModuleCategory[] = ["Ventas", "Compras y gastos", "Operaciones", "Finanzas"];

/** Tarjetas de los módulos con su interruptor. Solo quien gestiona la configuración puede cambiarlos. */
export function ModulesManager({ canManage, initialStates }: { canManage: boolean; initialStates: ModuleStateView[] }) {
  const router = useRouter();
  const [states, setStates] = useState(initialStates);
  const [saving, setSaving] = useState<ModuleId | null>(null);

  async function toggle(id: ModuleId, enabled: boolean) {
    setSaving(id);
    try {
      const response = await fetch("/api/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ moduleId: id, enabled }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar el módulo."));
      const body = await response.json() as { modules: ModuleStateView[] };
      setStates(body.modules);
      // El menú, las pestañas y la paleta se recargan con los módulos nuevos.
      invalidateActiveContext();
      router.refresh();
      toast.success(enabled ? `«${getModule(id).name}» activado.` : `«${getModule(id).name}» desactivado. Sus datos se conservan.`);
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo cambiar el módulo."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      {CATEGORIES.map((category) => {
        const modules = MODULES.filter((manifest) => manifest.category === category);
        if (modules.length === 0) return null;
        return (
          <section aria-labelledby={`modules-${category}`} className="space-y-2" key={category}>
            <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-muted-foreground" id={`modules-${category}`}>{category}</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {modules.map((manifest) => {
                const state = states.find((entry) => entry.id === manifest.id);
                const enabled = Boolean(state?.enabled);
                const switchId = `module-${manifest.id}`;
                return (
                  <li className={cn("flex flex-col gap-3 border bg-card p-3", enabled ? "border-primary/60" : "border-window-shadow")} data-testid={`module-card-${manifest.id}`} key={manifest.id}>
                    <div className="flex items-start gap-3">
                      <span className={cn("flex size-10 shrink-0 items-center justify-center border", enabled ? "border-primary bg-primary/10 text-primary" : "border-window-shadow text-muted-foreground")}>
                        <ModuleIcon className="size-5" id={manifest.id} />
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-mono text-sm font-bold">{manifest.name}</h3>
                          {manifest.isNew ? <StatusBadge tone="info"><Sparkle aria-hidden="true" className="mr-1 inline size-3" />Nuevo</StatusBadge> : null}
                          <StatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? "Activado" : "Desactivado"}</StatusBadge>
                        </div>
                        <p className="text-sm text-muted-foreground">{manifest.description}</p>
                      </div>
                    </div>
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                      {manifest.features.map((feature) => <li key={feature}>{feature}</li>)}
                    </ul>
                    {manifest.dependsOn?.length ? (
                      <p className="text-xs text-muted-foreground">Necesita: {manifest.dependsOn.map((dependency) => getModule(dependency).name).join(", ")}.</p>
                    ) : null}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-window-shadow pt-2">
                      <label className={cn("flex items-center gap-2 text-sm font-medium", !canManage && "opacity-70")} htmlFor={switchId}>
                        <input
                          aria-busy={saving === manifest.id || undefined}
                          checked={enabled}
                          className="size-4"
                          disabled={!canManage || saving !== null}
                          id={switchId}
                          onChange={(event) => void toggle(manifest.id, event.target.checked)}
                          role="switch"
                          type="checkbox"
                        />
                        {enabled ? "Activado" : "Activar"} {manifest.name}
                      </label>
                      {enabled ? (
                        <Link className="inline-flex items-center gap-1 text-sm font-semibold text-link underline" href={manifest.href}>
                          Abrir <ArrowRight aria-hidden="true" className="size-3.5" />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
