"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BankLedgerAccountField, type LedgerAccountOption } from "@/components/treasury/bank-ledger-account-field";
import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";
import { ibanHelperText } from "@/components/treasury/iban-helper";

type CreateBankAccountFormProps = {
  onCancel?: () => void;
  onSuccess?: () => void;
  redirectHref?: string;
  ledgerAccounts?: LedgerAccountOption[];
};

export function CreateBankAccountForm({ ledgerAccounts = [], onCancel, onSuccess, redirectHref }: CreateBankAccountFormProps = {}) {
  const router = useRouter();
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [bic, setBic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-2 md:grid-cols-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        try {
          const res = await fetch("/api/bank-accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ iban, bankName, accountId: accountId || null, bic: bic.trim() || null }),
          });
          if (!res.ok) throw new Error(await readApiError(res, "No se pudo crear la cuenta bancaria."));
          toast.success(`Cuenta ${bankName} creada.`, { description: "También se ha creado su forma de pago por transferencia." });
          setIban("");
          setBankName("");
          setAccountId("");
          setBic("");
          if (onSuccess) {
            onSuccess();
          } else if (redirectHref) {
            router.push(redirectHref);
          } else {
            router.refresh();
          }
        } catch (e) {
          const message = errorMessage(e, "No se pudo crear la cuenta bancaria.");
          setError(message);
          toast.error(message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <AccessibleField id="bank-account-name" label="Banco" required>
        <Input id="bank-account-name" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Banco Santander" required />
      </AccessibleField>
      <AccessibleField helperText={ibanHelperText(iban)} id="bank-account-iban" label="IBAN" required>
        <Input id="bank-account-iban" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" required />
      </AccessibleField>
      <BankLedgerAccountField id="bank-account-ledger" onChange={setAccountId} options={ledgerAccounts} value={accountId} />
      <AccessibleField helperText="Opcional. Se usa en las remesas SEPA (p. ej. CAIXESBBXXX)." id="bank-account-bic" label="BIC / SWIFT">
        <Input autoComplete="off" id="bank-account-bic" maxLength={11} value={bic} onChange={(e) => setBic(e.target.value.toUpperCase())} />
      </AccessibleField>
      <div className="flex gap-2 md:col-span-3 md:justify-end">
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button> : null}
        <Button type="submit" disabled={loading} aria-busy={loading}>{loading ? "Guardando…" : "Crear cuenta"}</Button>
      </div>
      {error ? <InlineAlert className="md:col-span-3" role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
