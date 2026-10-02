"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BankLedgerAccountField, type LedgerAccountOption } from "@/components/treasury/bank-ledger-account-field";
import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import type { TreasuryAccountKind } from "@/lib/treasury-accounts";
import { ibanHelperText } from "@/components/treasury/iban-helper";

type CreateBankAccountFormProps = {
  onCancel?: () => void;
  onSuccess?: () => void;
  redirectHref?: string;
  ledgerAccounts?: LedgerAccountOption[];
  /** Formas de pago sin cuenta (p. ej. «Stripe»): una pasarela nueva puede quedarse con la que ya usas. */
  unlinkedPaymentMethods?: Array<{ id: string; name: string }>;
  defaultKind?: TreasuryAccountKind;
};

export function CreateBankAccountForm({
  defaultKind = "BANK",
  ledgerAccounts = [],
  onCancel,
  onSuccess,
  redirectHref,
  unlinkedPaymentMethods = [],
}: CreateBankAccountFormProps = {}) {
  const router = useRouter();
  const [kind, setKind] = useState<TreasuryAccountKind>(defaultKind);
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [bic, setBic] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isProvider = kind === "PAYMENT_PROVIDER";
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
            body: JSON.stringify(isProvider
              ? { kind, bankName, accountId: accountId || null, paymentMethodId: paymentMethodId || null }
              : { kind, iban, bankName, accountId: accountId || null, bic: bic.trim() || null }),
          });
          if (!res.ok) throw new Error(await readApiError(res, "No se pudo crear la cuenta."));
          const linkedName = unlinkedPaymentMethods.find((method) => method.id === paymentMethodId)?.name;
          toast.success(isProvider ? `Pasarela ${bankName} creada.` : `Cuenta ${bankName} creada.`, {
            description: isProvider
              ? linkedName
                ? `Los cobros con «${linkedName}» se contabilizan ahora en ella.`
                : `También se ha creado la forma de pago «${bankName}».`
              : "También se ha creado su forma de pago por transferencia.",
          });
          setIban("");
          setBankName("");
          setAccountId("");
          setBic("");
          setPaymentMethodId("");
          if (onSuccess) {
            onSuccess();
          } else if (redirectHref) {
            router.push(redirectHref);
          } else {
            router.refresh();
          }
        } catch (e) {
          const message = errorMessage(e, "No se pudo crear la cuenta.");
          setError(message);
          toast.error(message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <AccessibleField
        className="md:col-span-3"
        helperText={isProvider
          ? "Stripe, PayPal, SumUp…: cobra tus facturas y te ingresa el dinero en el banco días después, ya descontada su comisión. Tiene su propio saldo."
          : "Cuenta corriente con IBAN."}
        id="bank-account-kind"
        label="Tipo"
      >
        <Select id="bank-account-kind" onChange={(event) => setKind(event.target.value as TreasuryAccountKind)} value={kind}>
          <option value="BANK">Cuenta bancaria</option>
          <option value="PAYMENT_PROVIDER">Pasarela de pago (Stripe, PayPal…)</option>
        </Select>
      </AccessibleField>
      <AccessibleField id="bank-account-name" label={isProvider ? "Nombre" : "Banco"} required>
        <Input id="bank-account-name" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder={isProvider ? "Stripe" : "Banco Santander"} required />
      </AccessibleField>
      {isProvider ? (
        <AccessibleField
          helperText="Si ya cobras con una forma de pago para esta pasarela, elígela para no duplicarla. Si no, se crea una con su nombre."
          id="bank-account-payment-method"
          label="Forma de pago"
        >
          <Select id="bank-account-payment-method" onChange={(event) => setPaymentMethodId(event.target.value)} value={paymentMethodId}>
            <option value="">Crear una nueva</option>
            {unlinkedPaymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
          </Select>
        </AccessibleField>
      ) : (
        <AccessibleField helperText={ibanHelperText(iban)} id="bank-account-iban" label="IBAN" required>
          <Input id="bank-account-iban" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" required />
        </AccessibleField>
      )}
      <BankLedgerAccountField id="bank-account-ledger" onChange={setAccountId} options={ledgerAccounts} value={accountId} />
      {isProvider ? null : (
        <AccessibleField helperText="Opcional. Se usa en las remesas SEPA (p. ej. CAIXESBBXXX)." id="bank-account-bic" label="BIC / SWIFT">
          <Input autoComplete="off" id="bank-account-bic" maxLength={11} value={bic} onChange={(e) => setBic(e.target.value.toUpperCase())} />
        </AccessibleField>
      )}
      <div className="flex gap-2 md:col-span-3 md:justify-end">
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button> : null}
        <Button type="submit" disabled={loading} aria-busy={loading}>{loading ? "Guardando…" : isProvider ? "Crear pasarela" : "Crear cuenta"}</Button>
      </div>
      {error ? <InlineAlert className="md:col-span-3" role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
