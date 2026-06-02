"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

export function EditBankAccountForm({ id, defaultBankName, defaultIban }: { id: string; defaultBankName: string; defaultIban: string }) {
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
          router.push("/treasury");
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error inesperado.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <Input value={bankName} onChange={(e) => setBankName(e.target.value)} required />
      <Input value={iban} onChange={(e) => setIban(e.target.value)} required />
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar cambios"}</Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
