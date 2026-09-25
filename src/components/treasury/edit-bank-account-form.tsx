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

export function EditBankAccountForm({
  id,
  defaultAccountId = "",
  defaultBankName,
  defaultIban,
  defaultBic = "",
  ledgerAccounts = [],
  onCancel,
  onSuccess,
}: {
  id: string;
  defaultAccountId?: string | null;
  defaultBankName: string;
  defaultIban: string;
  defaultBic?: string | null;
  ledgerAccounts?: LedgerAccountOption[];
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [bankName, setBankName] = useState(defaultBankName);
  const [iban, setIban] = useState(defaultIban);
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [bic, setBic] = useState(defaultBic ?? "");
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
          const res = await fetch(`/api/bank-accounts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ bankName, iban, accountId: accountId || null, bic: bic.trim() || null }),
          });
          if (!res.ok) throw new Error(await readApiError(res, "No se pudo guardar la cuenta bancaria."));
          toast.success("Cuenta bancaria actualizada.", { description: "Los próximos cobros, pagos y movimientos usarán la cuenta contable elegida." });
          if (onSuccess) onSuccess();
          else { router.push(`/treasury/bank-accounts/${id}`); router.refresh(); }
        } catch (e) {
          const message = errorMessage(e, "No se pudo guardar la cuenta bancaria.");
          setError(message);
          toast.error(message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <AccessibleField id={`edit-bank-name-${id}`} label="Banco" required><Input id={`edit-bank-name-${id}`} value={bankName} onChange={(e) => setBankName(e.target.value)} required /></AccessibleField>
      <AccessibleField helperText={ibanHelperText(iban)} id={`edit-bank-iban-${id}`} label="IBAN" required><Input id={`edit-bank-iban-${id}`} value={iban} onChange={(e) => setIban(e.target.value)} required /></AccessibleField>
      <BankLedgerAccountField id={`edit-bank-ledger-${id}`} onChange={setAccountId} options={ledgerAccounts} value={accountId} />
      <AccessibleField helperText="Opcional. Se usa en las remesas SEPA (p. ej. CAIXESBBXXX)." id={`edit-bank-bic-${id}`} label="BIC / SWIFT"><Input autoComplete="off" id={`edit-bank-bic-${id}`} maxLength={11} value={bic} onChange={(e) => setBic(e.target.value.toUpperCase())} /></AccessibleField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button> : null}<Button type="submit" disabled={loading} aria-busy={loading}>{loading ? "Guardando…" : "Guardar cambios"}</Button></div>
      {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
