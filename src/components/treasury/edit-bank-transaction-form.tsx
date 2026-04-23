"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AccountOption = { id: string; bankName: string; iban: string };

export function EditBankTransactionForm({
  id,
  accounts,
  defaultBankAccountId,
  defaultAmount,
  defaultDescription,
  defaultPostedAt,
}: {
  id: string;
  accounts: AccountOption[];
  defaultBankAccountId: string;
  defaultAmount: string;
  defaultDescription: string;
  defaultPostedAt: string;
}) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(defaultBankAccountId);
  const [amount, setAmount] = useState(defaultAmount);
  const [description, setDescription] = useState(defaultDescription);
  const [postedAt, setPostedAt] = useState(defaultPostedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        try {
          const res = await fetch(`/api/bank-transactions/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bankAccountId, amount, description, postedAt }),
          });
          if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Error");
          router.push("/treasury");
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error inesperado.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <select className="h-8 rounded-md border px-2 text-sm" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} - {a.iban}</option>)}
      </select>
      <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" required />
      <Input value={description} onChange={(e) => setDescription(e.target.value)} required />
      <Input value={postedAt} onChange={(e) => setPostedAt(e.target.value)} type="date" required />
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar cambios"}</Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
