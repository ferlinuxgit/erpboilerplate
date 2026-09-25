"use client";

import { Plus, Trash } from "@phosphor-icons/react";

import {
  calculateJournalTotals,
  emptyJournalLine,
  updateJournalLineAmount,
  type JournalFormLine,
} from "@/components/accounting/journal-entry-utils";
import { AccountPicker } from "@/components/ui/account-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/number-input";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

export type JournalAccountOption = { id: string; code: string; name: string };

type JournalLinesEditorProps = {
  accounts: JournalAccountOption[];
  lines: JournalFormLine[];
  onChange: (lines: JournalFormLine[]) => void;
  /** id del mensaje de error del formulario (se enlaza con aria-describedby). */
  errorId?: string;
};

/**
 * Líneas del asiento: cuenta con buscador (sin cuenta por defecto), debe y haber con formato
 * español ("1.234,56") y el cuadre en vivo.
 */
export function JournalLinesEditor({ accounts, errorId, lines, onChange }: JournalLinesEditorProps) {
  const totals = calculateJournalTotals(lines);
  const balanced = totals.isBalanced;

  function update(index: number, next: (line: JournalFormLine) => JournalFormLine) {
    onChange(lines.map((line, lineIndex) => (lineIndex === index ? next(line) : line)));
  }

  return (
    <div className="space-y-3">
      <div aria-label="Líneas del asiento" className="space-y-2" role="group">
        {lines.map((line, index) => (
          <div className="grid gap-3 rounded-[2px] border border-window-shadow p-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]" key={index}>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`journal-line-${index}-account`}>Cuenta de la línea {index + 1}</Label>
              <AccountPicker
                accounts={accounts}
                aria-describedby={errorId}
                id={`journal-line-${index}-account`}
                onChange={(accountId) => update(index, (current) => ({ ...current, accountId }))}
                placeholder="Busca por código o nombre (p. ej. 572, bancos, ventas)"
                recentKey="journal-entry"
                required
                value={line.accountId}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`journal-line-${index}-debit`}>Debe</Label>
              <MoneyInput
                aria-describedby={errorId}
                id={`journal-line-${index}-debit`}
                onChange={(event) => update(index, (current) => updateJournalLineAmount(current, "debit", event.currentTarget.value))}
                value={line.debit}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`journal-line-${index}-credit`}>Haber</Label>
              <MoneyInput
                aria-describedby={errorId}
                id={`journal-line-${index}-credit`}
                onChange={(event) => update(index, (current) => updateJournalLineAmount(current, "credit", event.currentTarget.value))}
                value={line.credit}
              />
            </div>
            <div className="flex items-end">
              <Button
                aria-label={`Eliminar la línea ${index + 1}`}
                disabled={lines.length <= 2}
                onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}
                title={lines.length <= 2 ? "Un asiento necesita al menos dos líneas" : undefined}
                type="button"
                variant="outline"
              >
                <Trash aria-hidden="true" />
                Eliminar línea
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button onClick={() => onChange([...lines, emptyJournalLine()])} type="button" variant="outline">
        <Plus aria-hidden="true" />
        Añadir línea
      </Button>
      <p aria-live="polite" className={cn("rounded-[1px] border px-2 py-1.5 font-mono text-sm", balanced ? "border-success bg-success/10 text-success-text" : "border-warning bg-warning/10 text-warning-text")}>
        Debe: {formatAmount(totals.totalDebit)} | Haber: {formatAmount(totals.totalCredit)} | Diferencia: {formatAmount(totals.difference)} | {balanced ? "Cuadrado" : "Descuadrado"}
      </p>
    </div>
  );
}
