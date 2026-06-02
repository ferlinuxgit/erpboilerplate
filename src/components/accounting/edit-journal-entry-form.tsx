"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { calculateJournalTotals, canSubmitJournalEntry, updateJournalLineAmount, type JournalFormLine } from "@/components/accounting/journal-entry-utils";

type AccountOption = { id: string; code: string; name: string };

type EntryLine = JournalFormLine;

function emptyLine(accounts: AccountOption[]): JournalFormLine {
  return { accountId: accounts[0]?.id ?? "", debit: "", credit: "" };
}

export function EditJournalEntryForm({
  id,
  accounts,
  defaultPostedAt,
  defaultReference,
  defaultLines,
}: {
  id: string;
  accounts: AccountOption[];
  defaultPostedAt: string;
  defaultReference: string;
  defaultLines: EntryLine[];
}) {
  const router = useRouter();
  const [postedAt, setPostedAt] = useState(defaultPostedAt);
  const [reference, setReference] = useState(defaultReference);
  const [lines, setLines] = useState<JournalFormLine[]>(defaultLines.length >= 2 ? defaultLines : [emptyLine(accounts), emptyLine(accounts)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totals = useMemo(() => calculateJournalTotals(lines), [lines]);
  const canSubmit = canSubmitJournalEntry({ postedAt, lines });
  const errorId = error ? "edit-journal-entry-error" : undefined;

  function updateLine(index: number, next: Partial<JournalFormLine>) {
    setLines((prev) => prev.map((line, lineIndex) => lineIndex === index ? { ...line, ...next } : line));
  }

  return (
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      if (!canSubmit) {
        setError("El asiento debe tener fecha, lineas validas y estar balanceado antes de guardar.");
        return;
      }
      setError(null);
      setLoading(true);
      try {
        const response = await fetch(`/api/journal-entries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ postedAt, reference, lines }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message ?? "No se pudo actualizar el asiento.");
        }
        toast.success("Asiento actualizado correctamente.");
        router.push("/accounting");
        router.refresh();
      } catch (submissionError) {
        const message = submissionError instanceof Error ? submissionError.message : "Error inesperado.";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    }}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="journal-posted-at">Fecha</Label>
          <Input id="journal-posted-at" type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} required aria-describedby={errorId} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="journal-reference">Referencia</Label>
          <Input id="journal-reference" value={reference} onChange={(e) => setReference(e.target.value)} aria-describedby={errorId} />
        </div>
      </div>
      <div className="space-y-3" aria-label="Lineas del asiento">
        {lines.map((line, index) => (
          <div key={index} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
            <div className="space-y-2">
              <Label htmlFor={`journal-line-${index}-account`}>Cuenta linea {index + 1}</Label>
              <Select
                id={`journal-line-${index}-account`}
                className="h-9"
                value={line.accountId}
                onChange={(e) => updateLine(index, { accountId: e.target.value })}
                aria-describedby={errorId}
              >
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`journal-line-${index}-debit`}>Debe</Label>
              <Input
                id={`journal-line-${index}-debit`}
                inputMode="decimal"
                min="0"
                step="0.01"
                type="number"
                value={line.debit}
                onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? updateJournalLineAmount(x, "debit", e.target.value) : x))}
                aria-describedby={errorId}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`journal-line-${index}-credit`}>Haber</Label>
              <Input
                id={`journal-line-${index}-credit`}
                inputMode="decimal"
                min="0"
                step="0.01"
                type="number"
                value={line.credit}
                onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? updateJournalLineAmount(x, "credit", e.target.value) : x))}
                aria-describedby={errorId}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" variant="outline" disabled={lines.length <= 2} onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>Eliminar linea</Button>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" onClick={() => setLines((prev) => [...prev, emptyLine(accounts)])}>Anadir linea</Button>
      <p className={`text-sm ${totals.isBalanced ? "text-emerald-700" : "text-amber-700"}`} aria-live="polite">
        Debe: {totals.totalDebit.toFixed(2)} | Haber: {totals.totalCredit.toFixed(2)} | Diferencia: {totals.difference.toFixed(2)} | {totals.isBalanced ? "Balanceado" : "Desbalanceado"}
      </p>
      {error ? <p id="edit-journal-entry-error" className="text-sm text-red-600" role="alert">{error}</p> : null}
      <Button type="submit" disabled={!canSubmit || loading}>{loading ? "Guardando..." : "Guardar cambios"}</Button>
    </form>
  );
}
