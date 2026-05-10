"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const errorId = error ? "bank-transaction-error" : undefined;

  return (
    <form
      className="grid gap-4 md:grid-cols-4"
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
          if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "No se pudo crear el movimiento.");
          setAmount("");
          setDescription("");
          setPostedAt("");
          toast.success("Movimiento bancario creado correctamente.");
          router.refresh();
        } catch (e) {
          const message = e instanceof Error ? e.message : "Error inesperado.";
          setError(message);
          toast.error(message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="bank-transaction-account">Cuenta bancaria</Label>
        <select
          id="bank-transaction-account"
          className="h-8 rounded-md border px-2 text-sm"
          value={bankAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
          required
          aria-describedby={errorId}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.bankName} - {a.iban}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="bank-transaction-amount">Importe</Label>
        <Input
          id="bank-transaction-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          step="0.01"
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bank-transaction-description">Descripcion</Label>
        <Input
          id="bank-transaction-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bank-transaction-posted-at">Fecha</Label>
        <Input
          id="bank-transaction-posted-at"
          value={postedAt}
          onChange={(e) => setPostedAt(e.target.value)}
          type="date"
          required
          aria-describedby={errorId}
        />
      </div>
      <Button className="md:col-span-4" type="submit" disabled={loading}>{loading ? "Guardando..." : "Crear movimiento"}</Button>
      {error ? <p id="bank-transaction-error" className="text-sm text-red-600 md:col-span-4" role="alert">{error}</p> : null}
    </form>
  );
}
