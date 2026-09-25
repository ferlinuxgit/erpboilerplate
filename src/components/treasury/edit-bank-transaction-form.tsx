"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";

type AccountOption = { id: string; bankName: string; iban: string; isActive?: boolean };

export function EditBankTransactionForm({
  id,
  accounts,
  defaultBankAccountId,
  defaultAmount,
  defaultDescription,
  defaultPostedAt,
  onCancel,
  onSuccess,
}: {
  id: string;
  accounts: AccountOption[];
  defaultBankAccountId: string;
  defaultAmount: string;
  defaultDescription: string;
  defaultPostedAt: string;
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(defaultBankAccountId);
  const [amount, setAmount] = useState(defaultAmount);
  const [description, setDescription] = useState(defaultDescription);
  const [postedAt, setPostedAt] = useState(defaultPostedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error ? "edit-bank-transaction-error" : undefined;
  const selectableAccounts = accounts.filter((account) => account.isActive !== false || account.id === defaultBankAccountId);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        const parsedAmount = parseDecimalInput(amount);
        if (parsedAmount === null || parsedAmount === 0) {
          setError("Indica un importe distinto de cero: positivo si entra dinero, negativo si sale.");
          return;
        }
        setLoading(true);
        try {
          const res = await fetch(`/api/bank-transactions/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ bankAccountId, amount: parsedAmount.toFixed(2), description, postedAt }),
          });
          if (!res.ok) throw new Error(await readApiError(res, "No se pudo actualizar el movimiento."));
          toast.success("Movimiento actualizado.", { description: "Sigue pendiente de conciliar, ya con los datos nuevos." });
          if (onSuccess) onSuccess();
          else { router.push("/treasury/bank-transactions"); router.refresh(); }
        } catch (e) {
          const message = errorMessage(e, "No se pudo actualizar el movimiento.");
          setError(message);
          toast.error(message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <AccessibleField id="edit-bank-transaction-account" label="Cuenta bancaria" required>
        <Select id="edit-bank-transaction-account" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
          {selectableAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.bankName} · {a.iban}</option>
          ))}
        </Select>
      </AccessibleField>
      <AccessibleField helperText="Positivo si entra dinero, negativo si sale." id="edit-bank-transaction-amount" label="Importe" required>
        <MoneyInput id="edit-bank-transaction-amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </AccessibleField>
      <AccessibleField id="edit-bank-transaction-description" label="Concepto" required>
        <Input id="edit-bank-transaction-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
      </AccessibleField>
      <AccessibleField id="edit-bank-transaction-posted-at" label="Fecha" required>
        <Input id="edit-bank-transaction-posted-at" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} type="date" required />
      </AccessibleField>
      <p className="text-xs text-muted-foreground">Solo se pueden editar movimientos pendientes de conciliar y con fechas en periodos abiertos.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? <Button onClick={onCancel} type="button" variant="outline">Cancelar</Button> : null}
        <Button aria-busy={loading} aria-describedby={errorId} type="submit" disabled={loading}>{loading ? "Guardando…" : "Guardar cambios"}</Button>
      </div>
      {error ? <InlineAlert id="edit-bank-transaction-error" role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
