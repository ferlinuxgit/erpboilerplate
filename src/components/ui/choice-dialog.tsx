"use client";

import { PencilSimple } from "@phosphor-icons/react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type DialogChoice = { value: string; label: string; description?: string };
export type DialogChoiceGroup = { key: string; legend: string; choices: readonly DialogChoice[]; value: string };

/**
 * Selector en diálogo: un botón con lo elegido que abre un diálogo con uno o varios grupos de
 * opciones (radio) y «Aplicar» / «Cancelar». Es el patrón de los impuestos de las líneas, el
 * tratamiento de IVA o la retención: opciones grandes, con explicación y nada flotando sobre la
 * página.
 */
export function ChoiceDialogButton({
  ariaLabel,
  className,
  describedBy,
  description,
  groups,
  id,
  invalid,
  onApply,
  summary,
  testId = id,
  title,
}: {
  /** Nombre accesible del botón (p. ej. «IVA de la línea 1: IVA 21 %. Cambiar»). */
  ariaLabel: string;
  className?: string;
  describedBy?: string;
  description?: string;
  groups: readonly DialogChoiceGroup[];
  id: string;
  invalid?: boolean;
  onApply: (values: Record<string, string>) => void;
  /** Texto del botón: lo elegido. */
  summary: string;
  testId?: string;
  title: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, string>>({});

  const openDialog = () => {
    setDraft(Object.fromEntries(groups.map((group) => [group.key, group.value])));
    setOpen(true);
  };
  const apply = () => {
    onApply(draft);
    setOpen(false);
  };

  return (
    <>
      <Button
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        className={cn("h-9 w-full min-w-0 justify-between gap-2 px-2 font-mono text-xs font-normal", className)}
        data-testid={testId}
        id={id}
        onClick={openDialog}
        type="button"
        variant="outline"
      >
        <span className="truncate">{summary}</span>
        <PencilSimple aria-hidden="true" className="shrink-0" />
      </Button>
      <Dialog description={description} onClose={() => setOpen(false)} open={open} size="sm" title={title}>
        <div className="grid gap-3">
          {groups.map((group) => (
            <ChoiceGroup
              group={group}
              key={group.key}
              name={`${id}-${group.key}`}
              onChange={(value) => setDraft((current) => ({ ...current, [group.key]: value }))}
              showLegend={groups.length > 1}
              value={draft[group.key] ?? group.value}
            />
          ))}
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
          <Button data-testid={`${testId}-apply`} onClick={apply} type="button">Aplicar</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

function ChoiceGroup({ group, name, onChange, showLegend, value }: { group: DialogChoiceGroup; name: string; onChange: (value: string) => void; showLegend: boolean; value: string }) {
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className={showLegend ? "mb-1 font-mono text-xs font-bold uppercase tracking-[0.04em]" : "sr-only"}>{group.legend}</legend>
      {group.choices.map((choice) => {
        const checked = choice.value === value;
        return (
          <label
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-control border px-2 py-2 pointer-coarse:min-h-11",
              checked ? "border-primary bg-window-panel" : "border-window-shadow hover:bg-window-panel",
            )}
            key={choice.value}
          >
            <input checked={checked} className="mt-0.5 size-4 shrink-0 accent-primary" name={name} onChange={() => onChange(choice.value)} type="radio" value={choice.value} />
            <span className="min-w-0">
              <span className={cn("block font-mono text-sm", checked && "font-bold")}>{choice.label}</span>
              {choice.description ? <span className="block text-xs text-muted-foreground">{choice.description}</span> : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
