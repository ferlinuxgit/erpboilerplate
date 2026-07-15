"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccessibleField } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { accountTypeLabels, statusLabel } from "@/lib/status-labels";

const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "MIXED"] as const;

type CreateAccountFormProps = {
  onCancel?: () => void;
  onSuccess?: () => void;
  redirectHref?: string;
};

export function CreateAccountForm({ onCancel, onSuccess, redirectHref }: CreateAccountFormProps = {}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof accountTypes)[number]>("ASSET");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="grid gap-2 md:grid-cols-4" onSubmit={async (event) => {
      event.preventDefault();
      setLoading(true); setError(null);
      try {
        const res = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ code, name, type }) });
        if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Error");
        setCode(""); setName(""); setType("ASSET");
        if (onSuccess) {
          onSuccess();
        } else if (redirectHref) {
          router.push(redirectHref);
        } else {
          router.refresh();
        }
      } catch (e) { setError(e instanceof Error ? e.message : "Error inesperado."); } finally { setLoading(false); }
    }}>
      <AccessibleField id="account-code" label="Código" required><Input id="account-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="4300" required /></AccessibleField>
      <AccessibleField id="account-name" label="Nombre" required><Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Clientes" required /></AccessibleField>
      <AccessibleField id="account-type" label="Tipo" required><Select id="account-type" value={type} onChange={(e) => setType(e.target.value as (typeof accountTypes)[number])}>{accountTypes.map((option) => <option key={option} value={option}>{statusLabel(accountTypeLabels, option)}</option>)}</Select></AccessibleField>
      <div className="flex gap-2 self-end md:justify-end">{onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button> : null}<Button type="submit" disabled={loading}>{loading ? "Guardando…" : "Crear cuenta"}</Button></div>
      {error ? <InlineAlert className="md:col-span-4" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
