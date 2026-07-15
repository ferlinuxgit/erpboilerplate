"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";

type CreateBankAccountFormProps = {
  onCancel?: () => void;
  onSuccess?: () => void;
  redirectHref?: string;
};

export function CreateBankAccountForm({ onCancel, onSuccess, redirectHref }: CreateBankAccountFormProps = {}) {
  const router = useRouter();
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
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
            body: JSON.stringify({ iban, bankName }),
          });
          if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Error");
          setIban("");
          setBankName("");
          if (onSuccess) {
            onSuccess();
          } else if (redirectHref) {
            router.push(redirectHref);
          } else {
            router.refresh();
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error inesperado.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <AccessibleField id="bank-account-name" label="Banco" required>
        <Input id="bank-account-name" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Banco Santander" required />
      </AccessibleField>
      <AccessibleField id="bank-account-iban" label="IBAN" required>
        <Input id="bank-account-iban" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" required />
      </AccessibleField>
      <div className="flex gap-2 self-end md:justify-end">
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button> : null}
        <Button type="submit" disabled={loading}>{loading ? "Guardando…" : "Crear cuenta"}</Button>
      </div>
      {error ? <InlineAlert className="md:col-span-3" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
