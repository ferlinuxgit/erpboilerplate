"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

export function CreateBankAccountForm() {
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
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error inesperado.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Banco" required />
      <Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IBAN" required />
      <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Crear cuenta"}</Button>
      {error ? <p className="text-sm text-red-600 md:col-span-3">{error}</p> : null}
    </form>
  );
}
