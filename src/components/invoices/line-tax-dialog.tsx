"use client";

import { PencilSimple } from "@phosphor-icons/react";
import * as React from "react";

import { lineTaxSelects, lineTaxSummary, taxIdsFromSelects, type LineTaxSelectOption, type TaxSelectChoice } from "@/components/invoices/line-tax-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Impuestos de una línea: un botón con lo elegido («IVA 21 % · IRPF 15 %») que abre un diálogo
 * con dos grupos de opciones, «IVA» y «Retención». Se aplica al pulsar «Aplicar».
 */
export function LineTaxDialog({
  describedBy,
  id,
  invalid,
  lineNumber,
  onChange,
  selectedTaxIds,
  taxes,
}: {
  describedBy?: string;
  id: string;
  invalid?: boolean;
  lineNumber: number;
  onChange?: (taxIds: string[]) => void;
  selectedTaxIds?: readonly string[];
  taxes: readonly LineTaxSelectOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const selects = lineTaxSelects(taxes, selectedTaxIds);
  const summary = lineTaxSummary(selects);
  // Elección provisional mientras el diálogo está abierto.
  const [added, setAdded] = React.useState(selects.added.value);
  const [withheld, setWithheld] = React.useState(selects.withheld.value);

  const openDialog = () => {
    setAdded(selects.added.value);
    setWithheld(selects.withheld.value);
    setOpen(true);
  };
  const apply = () => {
    onChange?.(taxIdsFromSelects(added, withheld));
    setOpen(false);
  };

  return (
    <>
      <Button
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-label={`Impuestos de la línea ${lineNumber}: ${summary}. Cambiar`}
        className="h-9 w-full min-w-0 justify-between gap-2 px-2 font-mono text-xs font-normal"
        data-testid={id}
        id={id}
        onClick={openDialog}
        type="button"
        variant="outline"
      >
        <span className="truncate">{summary}</span>
        <PencilSimple aria-hidden="true" className="shrink-0" />
      </Button>
      <Dialog onClose={() => setOpen(false)} open={open} size="sm" title={`Impuestos de la línea ${lineNumber}`}>
        <div className="grid gap-3">
          <TaxChoiceGroup choices={selects.added.choices} legend="IVA" name={`${id}-added`} onChange={setAdded} value={added} />
          {selects.hasWithholding ? (
            <TaxChoiceGroup choices={selects.withheld.choices} legend="Retención (IRPF)" name={`${id}-withheld`} onChange={setWithheld} value={withheld} />
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
          <Button data-testid={`${id}-apply`} onClick={apply} type="button">Aplicar</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

function TaxChoiceGroup({ choices, legend, name, onChange, value }: { choices: TaxSelectChoice[]; legend: string; name: string; onChange: (value: string) => void; value: string }) {
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="mb-1 font-mono text-xs font-bold uppercase tracking-[0.04em]">{legend}</legend>
      {choices.map((choice) => (
        <label
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-control border px-2 py-2 font-mono text-sm pointer-coarse:min-h-11",
            choice.value === value ? "border-primary bg-window-panel font-bold" : "border-window-shadow hover:bg-window-panel",
          )}
          key={choice.value}
        >
          <input checked={choice.value === value} className="size-4 shrink-0 accent-primary" name={name} onChange={() => onChange(choice.value)} type="radio" value={choice.value} />
          <span className="min-w-0">{choice.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
