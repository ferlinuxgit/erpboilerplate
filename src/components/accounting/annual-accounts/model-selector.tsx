"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const FAILURE = "No se pudo guardar el modelo.";

type Option = { id: string; name: string };

/** Modelo de cuentas anuales de la empresa: se guarda como ajuste y se usa en todos los ejercicios. */
export function AnnualAccountsModelSelector({ canEdit, current, options }: { canEdit: boolean; current: string; options: Option[] }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    try {
      const response = await fetch("/api/accounting/annual-accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: value }) });
      if (!response.ok) throw new Error(await readApiError(response, FAILURE));
      toast.success("Modelo de cuentas anuales guardado.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, FAILURE));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="annual-accounts-model">Modelo que presenta la empresa</Label>
        <Select className="w-56" disabled={!canEdit || pending} id="annual-accounts-model" onChange={(event) => setValue(event.target.value)} value={value}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </Select>
      </div>
      {canEdit ? <Button aria-busy={pending} disabled={pending || value === current} onClick={() => void save()} type="button" variant="secondary">{pending ? "Guardando…" : "Guardar modelo"}</Button> : null}
    </div>
  );
}
