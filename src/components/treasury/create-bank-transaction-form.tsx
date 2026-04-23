"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

type AccountOption = { id: string; bankName: string; iban: string };

export function CreateBankTransactionForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [postedAt, setPostedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-2 md:grid-cols-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        try {
          const res = await fetch("/api/bank-transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ bankAccountId, amount, description, postedAt }),
          });
          if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Error");
          setAmount("");
          setDescription("");
          setPostedAt("");
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error inesperado.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <select className="h-8 rounded-md border px-2 text-sm" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.bankName} - {a.iban}</option>
        ))}
      </select>
      <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Importe" type="number" step="0.01" required />
      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripcion" required />
      <Input value={postedAt} onChange={(e) => setPostedAt(e.target.value)} type="date" required />
      <Button className="md:col-span-4" type="submit" disabled={loading}>{loading ? "Guardando..." : "Crear movimiento"}</Button>
      {error ? <p className="text-sm text-red-600 md:col-span-4">{error}</p> : null}
    </form>
  );
}
