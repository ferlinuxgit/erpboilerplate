"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { calculateJournalTotals, canSubmitJournalEntry, updateJournalLineAmount, type JournalFormLine } from "@/components/accounting/journal-entry-utils";

type AccountOption = { id: string; code: string; name: string };

function emptyLine(accounts: AccountOption[]): JournalFormLine {
  return { accountId: accounts[0]?.id ?? "", debit: "", credit: "" };
}

type CreateJournalEntryFormProps = {
  accounts: AccountOption[];
  redirectHref?: string;
};

export function CreateJournalEntryForm({ accounts, redirectHref }: CreateJournalEntryFormProps) {
  const router = useRouter();
  const [postedAt, setPostedAt] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JournalFormLine[]>([emptyLine(accounts), emptyLine(accounts)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totals = useMemo(() => calculateJournalTotals(lines), [lines]);
  const canSubmit = canSubmitJournalEntry({ postedAt, lines });
  const errorId = error ? "create-journal-entry-error" : undefined;

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
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/journal-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ postedAt, reference, lines }),
        });
        if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "No se pudo crear el asiento.");
        setReference("");
        setPostedAt("");
        setLines([emptyLine(accounts), emptyLine(accounts)]);
        if (redirectHref) {
          router.push(redirectHref);
        } else {
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error inesperado.");
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
          <Input id="journal-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referencia" aria-describedby={errorId} />
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
      {error ? <p id="create-journal-entry-error" className="text-sm text-red-600" role="alert">{error}</p> : null}
      <Button type="submit" disabled={loading || !canSubmit}>{loading ? "Guardando..." : "Crear asiento"}</Button>
    </form>
  );
}
