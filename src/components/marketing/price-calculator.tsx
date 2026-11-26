"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { BASE_PLAN, MODULE_MONTHLY_CENTS, TRIAL_DAYS, formatEuros, modulesMonthlyCents } from "@/lib/billing/catalog";
import { MODULES, type ModuleId } from "@/modules/registry";

/** Añade las dependencias (p. ej. Hostelería necesita el TPV). */
function withDependencies(selected: ReadonlySet<ModuleId>) {
  const result = new Set(selected);
  for (const manifest of MODULES) if (result.has(manifest.id)) for (const dependency of manifest.dependsOn ?? []) result.add(dependency);
  return result;
}

/** Quita también los que dependían del módulo quitado. */
function withoutDependents(selected: ReadonlySet<ModuleId>, removed: ModuleId) {
  const result = new Set(selected);
  result.delete(removed);
  for (const manifest of MODULES) if (manifest.dependsOn?.includes(removed)) result.delete(manifest.id);
  return result;
}

/** Calculadora del precio: plan base (anual) más los módulos marcados (al mes). */
export function PriceCalculator() {
  const [selected, setSelected] = useState<ReadonlySet<ModuleId>>(() => new Set());
  const modulesTotal = useMemo(() => modulesMonthlyCents([...selected]), [selected]);

  const toggle = (moduleId: ModuleId, checked: boolean) => {
    setSelected((current) => (checked ? withDependencies(new Set([...current, moduleId])) : withoutDependents(current, moduleId)));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <fieldset className="min-w-0">
        <legend className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-window-muted">Marca los módulos que usarías</legend>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <li className="flex items-center gap-2 rounded-control border border-window-dark-shadow bg-window-panel px-2.5 py-2 shadow-sunken">
            <input aria-describedby="calc-base-note" checked disabled type="checkbox" />
            <span className="min-w-0 flex-1 text-sm font-bold">Plan base</span>
            <span className="font-mono text-sm font-bold tabular-nums">{formatEuros(BASE_PLAN.yearlyCents)}/año</span>
          </li>
          {MODULES.map((manifest) => {
            const id = `calc-${manifest.id}`;
            const checked = selected.has(manifest.id);
            return (
              <li key={manifest.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-window-dark-shadow bg-card px-2.5 py-2 shadow-raised hover:bg-window-highlight has-checked:bg-window-highlight has-checked:shadow-pressed" htmlFor={id}>
                  <input checked={checked} id={id} onChange={(event) => toggle(manifest.id, event.target.checked)} type="checkbox" />
                  <span className="min-w-0 flex-1 text-sm">
                    {manifest.name}
                    {manifest.dependsOn?.length ? <span className="block text-xs text-muted-foreground">Incluye {manifest.dependsOn.map((dep) => MODULES.find((entry) => entry.id === dep)?.name).join(", ")}</span> : null}
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums">+{formatEuros(MODULE_MONTHLY_CENTS[manifest.id])}/mes</span>
                </label>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground" id="calc-base-note">El plan base siempre está incluido: {formatEuros(BASE_PLAN.yearlyCents)} al año (equivale a {formatEuros(BASE_PLAN.monthlyCents)} al mes), pago anual.</p>
      </fieldset>

      <div className="flex flex-col justify-between gap-3 rounded-surface border border-window-dark-shadow bg-card p-3 shadow-sunken lg:sticky lg:top-16 lg:self-start">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">Tu precio</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{formatEuros(BASE_PLAN.yearlyCents)}<span className="text-sm font-normal text-muted-foreground"> /año · plan base</span></p>
          <p aria-live="polite" className="font-mono text-2xl font-bold tabular-nums" data-testid="calculator-total">+{formatEuros(modulesTotal)}<span className="text-sm font-normal text-muted-foreground"> /mes · módulos</span></p>
          <p className="text-xs text-muted-foreground">+ IVA · {selected.size === 0 ? "solo el plan base" : `${selected.size} módulo${selected.size === 1 ? "" : "s"}, mes a mes`}</p>
        </div>
        <Link className={buttonVariants({ size: "lg", className: "w-full" })} href="/auth/register">Probar {TRIAL_DAYS} días gratis</Link>
        <p className="text-xs text-muted-foreground">Durante la prueba tienes todos los módulos. Eliges al final.</p>
      </div>
    </div>
  );
}
