"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AccountOption = { id: string; code: string; name: string };
type EntryLine = { accountId: string; debit: string; credit: string };

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
  const [lines, setLines] = useState<EntryLine[]>(defaultLines);
  const totalDebit = useMemo(() => lines.reduce((acc, line) => acc + Number(line.debit || 0), 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((acc, line) => acc + Number(line.credit || 0), 0), [lines]);
  const isBalanced = Number(totalDebit.toFixed(2)) === Number(totalCredit.toFixed(2)) && totalDebit > 0;

  return (
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      await fetch(`/api/journal-entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postedAt, reference, lines }) });
      router.push("/accounting");
      router.refresh();
    }}>
      <div className="grid gap-2 md:grid-cols-2">
        <Input type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} required />
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referencia" />
      </div>
      {lines.map((line, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-4">
          <select className="h-8 rounded-md border px-2 text-sm" value={line.accountId} onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? { ...x, accountId: e.target.value } : x))}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
          </select>
          <Input type="number" step="0.01" value={line.debit} onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? { ...x, debit: e.target.value } : x))} />
          <Input type="number" step="0.01" value={line.credit} onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? { ...x, credit: e.target.value } : x))} />
          <Button type="button" variant="outline" disabled={lines.length <= 2} onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>Eliminar linea</Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => setLines((prev) => [...prev, { accountId: accounts[0]?.id ?? "", debit: "", credit: "" }])}>Anadir linea</Button>
      <p className={`text-sm ${isBalanced ? "text-emerald-700" : "text-amber-700"}`}>Debe: {totalDebit.toFixed(2)} | Haber: {totalCredit.toFixed(2)} | {isBalanced ? "Balanceado" : "Desbalanceado"}</p>
      <Button type="submit" disabled={!isBalanced}>Guardar cambios</Button>
    </form>
  );
}
