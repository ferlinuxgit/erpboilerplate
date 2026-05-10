"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";

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
  const errorId = error ? "edit-bank-transaction-error" : undefined;

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
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ bankAccountId, amount, description, postedAt }),
          });
          if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "No se pudo actualizar el movimiento.");
          toast.success("Movimiento bancario actualizado correctamente.");
          router.push("/treasury");
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
        <Label htmlFor="edit-bank-transaction-account">Cuenta bancaria</Label>
        <select
          id="edit-bank-transaction-account"
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
        <Label htmlFor="edit-bank-transaction-amount">Importe</Label>
        <Input
          id="edit-bank-transaction-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          step="0.01"
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-bank-transaction-description">Descripción</Label>
        <Input
          id="edit-bank-transaction-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          aria-describedby={errorId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-bank-transaction-posted-at">Fecha</Label>
        <Input
          id="edit-bank-transaction-posted-at"
          value={postedAt}
          onChange={(e) => setPostedAt(e.target.value)}
          type="date"
          required
          aria-describedby={errorId}
        />
      </div>
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar cambios"}</Button>
      {error ? <p id="edit-bank-transaction-error" className="text-sm text-red-600" role="alert">{error}</p> : null}
    </form>
  );
}
