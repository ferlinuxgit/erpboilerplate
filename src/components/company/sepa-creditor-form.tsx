"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { buildCreditorId, checkCreditorId } from "@/lib/bank-import/sepa-creditor";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Identificador de acreedor SEPA (lo da el banco al contratar las remesas de recibos domiciliados). */
export function SepaCreditorForm({ initialValue, vatNumber }: { initialValue: string | null; vatNumber: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);
  const check = value.trim() ? checkCreditorId(value) : null;
  const suggestion = !value.trim() && vatNumber ? buildCreditorId(vatNumber) : null;

  async function save() {
    if (check && !check.valid) return;
    setSaving(true);
    try {
      const response = await fetch("/api/sepa/creditor-id", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ creditorId: value.trim() || null }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el identificador."));
      toast.success(value.trim() ? "Identificador de acreedor guardado." : "Identificador de acreedor borrado.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el identificador.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <AccessibleField
        error={check && !check.valid ? check.reason : undefined}
        helperText="Te lo asigna tu banco al contratar el cobro de recibos domiciliados (adeudos SEPA). Suele ser ES + 2 cifras + 000 + tu NIF."
        id="company-sepa-creditor-id"
        label="Identificador de acreedor SEPA"
      >
        <Input
          aria-invalid={check && !check.valid ? true : undefined}
          maxLength={40}
          onChange={(event) => setValue(event.target.value.toUpperCase())}
          placeholder="ES12000B12345678"
          value={value}
        />
      </AccessibleField>
      {suggestion ? (
        <p className="text-xs text-muted-foreground">
          Con tu NIF y el sufijo habitual (000) sería <button className="font-mono text-primary underline" onClick={() => setValue(suggestion)} type="button">{suggestion}</button>. Confírmalo con tu banco: el sufijo puede ser otro.
        </p>
      ) : null}
      <Button disabled={saving || Boolean(check && !check.valid)} onClick={() => void save()} type="button">{saving ? "Guardando…" : "Guardar identificador"}</Button>
    </div>
  );
}
