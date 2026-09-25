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

type CreateBankTransactionFormProps = {
  accounts: AccountOption[];
  onCancel?: () => void;
  onSuccess?: () => void;
  redirectHref?: string;
  initialBankAccountId?: string;
};

export function CreateBankTransactionForm({ accounts, initialBankAccountId, onCancel, onSuccess, redirectHref }: CreateBankTransactionFormProps) {
  const router = useRouter();
  const activeAccounts = accounts.filter((account) => account.isActive !== false);
  // Cuenta de la URL (desde la ficha del banco) o, si no, la primera activa (la única en la mayoría de pymes).
  const [bankAccountId, setBankAccountId] = useState(activeAccounts.some((account) => account.id === initialBankAccountId) ? initialBankAccountId ?? "" : activeAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [postedAt, setPostedAt] = useState(() => new Date().toISOString().slice(0, 10));
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
        const parsedAmount = parseDecimalInput(amount);
        if (parsedAmount === null || parsedAmount === 0) {
          setError("Indica un importe distinto de cero: positivo si entra dinero, negativo si sale.");
          setLoading(false);
          return;
        }
        try {
          const res = await fetch("/api/bank-transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ bankAccountId, amount: parsedAmount.toFixed(2), description, postedAt }),
          });
          if (!res.ok) throw new Error(await readApiError(res, "No se pudo registrar el movimiento."));
          setAmount("");
          setDescription("");
          toast.success("Movimiento registrado.", { description: "Queda «pendiente de conciliar»: dile en la conciliación a qué corresponde." });
          if (onSuccess) {
            onSuccess();
          } else if (redirectHref) {
            router.push(redirectHref);
          } else {
            router.refresh();
          }
        } catch (e) {
          const message = errorMessage(e, "No se pudo registrar el movimiento.");
          setError(message);
          toast.error(message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <AccessibleField id="bank-transaction-account" label="Cuenta bancaria" required>
        <Select id="bank-transaction-account" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
          {activeAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.bankName} · {a.iban}</option>
          ))}
        </Select>
      </AccessibleField>
      <AccessibleField helperText="Positivo si entra dinero, negativo si sale (p. ej. -12,50)." id="bank-transaction-amount" label="Importe" required>
        <MoneyInput id="bank-transaction-amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </AccessibleField>
      <AccessibleField helperText="Tal como aparece en el extracto; ayuda a conciliarlo." id="bank-transaction-description" label="Concepto" required>
        <Input id="bank-transaction-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
      </AccessibleField>
      <AccessibleField id="bank-transaction-posted-at" label="Fecha" required>
        <Input id="bank-transaction-posted-at" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} type="date" required />
      </AccessibleField>
      <p className="text-xs text-muted-foreground md:col-span-4">
        El dinero entra o sale del banco al momento, pero hasta que digas a qué corresponde (un cobro, un pago, una comisión…) queda como «pendiente de identificar» (cuenta 555). Al conciliarlo se corrige solo y el banco no cuenta dos veces. Si tienes el extracto, mejor impórtalo: te ahorras teclear.
      </p>
      <div className="flex flex-col-reverse gap-2 md:col-span-4 sm:flex-row sm:justify-end">
        {onCancel ? <Button onClick={onCancel} type="button" variant="outline">Cancelar</Button> : null}
        <Button aria-busy={loading} aria-describedby={errorId} type="submit" disabled={loading || !bankAccountId}>{loading ? "Guardando…" : "Registrar movimiento"}</Button>
      </div>
      {activeAccounts.length === 0 ? <InlineAlert className="md:col-span-4" tone="warning">No hay cuentas bancarias activas. Crea o reactiva una cuenta para registrar movimientos.</InlineAlert> : null}
      {error ? <InlineAlert className="md:col-span-4" id="bank-transaction-error" role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
