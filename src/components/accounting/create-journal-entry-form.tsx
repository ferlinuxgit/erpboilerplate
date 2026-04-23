"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

type AccountOption = { id: string; code: string; name: string };
type EntryLine = { accountId: string; debit: string; credit: string };

export function CreateJournalEntryForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [postedAt, setPostedAt] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<EntryLine[]>([
    { accountId: accounts[0]?.id ?? "", debit: "", credit: "" },
    { accountId: accounts[0]?.id ?? "", debit: "", credit: "" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalDebit = useMemo(() => lines.reduce((acc, l) => acc + Number(l.debit || 0), 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((acc, l) => acc + Number(l.credit || 0), 0), [lines]);
  const isBalanced = Number(totalDebit.toFixed(2)) === Number(totalCredit.toFixed(2)) && totalDebit > 0;
  const hasEmpty = lines.some((line) => !line.accountId || (!line.debit && !line.credit));

  return (
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      setLoading(true); setError(null);
      try {
        const res = await fetch("/api/journal-entries", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ postedAt, reference, lines }) });
        if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Error");
        setReference(""); setPostedAt(""); router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : "Error inesperado."); } finally { setLoading(false); }
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
          <Input type="number" step="0.01" placeholder="Debe" value={line.debit} onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? { ...x, debit: e.target.value } : x))} />
          <Input type="number" step="0.01" placeholder="Haber" value={line.credit} onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? { ...x, credit: e.target.value } : x))} />
          <Button type="button" variant="outline" disabled={lines.length <= 2} onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>Eliminar linea</Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => setLines((prev) => [...prev, { accountId: accounts[0]?.id ?? "", debit: "", credit: "" }])}>Anadir linea</Button>
      <p className={`text-sm ${isBalanced ? "text-emerald-700" : "text-amber-700"}`}>Debe: {totalDebit.toFixed(2)} | Haber: {totalCredit.toFixed(2)} | {isBalanced ? "Balanceado" : "Desbalanceado"}</p>
      <Button type="submit" disabled={loading || hasEmpty || !isBalanced}>{loading ? "Guardando..." : "Crear asiento"}</Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
