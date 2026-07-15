"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";

export function EditBankAccountForm({ id, defaultBankName, defaultIban, onCancel, onSuccess }: { id: string; defaultBankName: string; defaultIban: string; onCancel?: () => void; onSuccess?: () => void }) {
  const router = useRouter();
  const [bankName, setBankName] = useState(defaultBankName);
  const [iban, setIban] = useState(defaultIban);
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
            body: JSON.stringify({ bankName, iban }),
          });
          if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Error");
          if (onSuccess) onSuccess();
          else { router.push("/treasury"); router.refresh(); }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error inesperado.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <AccessibleField id={`edit-bank-name-${id}`} label="Banco" required><Input id={`edit-bank-name-${id}`} value={bankName} onChange={(e) => setBankName(e.target.value)} required /></AccessibleField>
      <AccessibleField id={`edit-bank-iban-${id}`} label="IBAN" required><Input id={`edit-bank-iban-${id}`} value={iban} onChange={(e) => setIban(e.target.value)} required /></AccessibleField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button> : null}<Button type="submit" disabled={loading}>{loading ? "Guardando…" : "Guardar cambios"}</Button></div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
