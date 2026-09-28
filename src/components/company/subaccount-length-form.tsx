"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { readApiError } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

const LENGTHS = [8, 9, 10, 11, 12] as const;

/** Longitud de las subcuentas contables. Solo lectura en cuanto la empresa tiene asientos. */
export function SubaccountLengthForm({ initialValue, locked }: { initialValue: number; locked: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const example = (code: string) => code.padEnd(value - 1, "0") + "1";

  async function save() {
    setPending(true);
    try {
      const response = await fetch("/api/accounting/subaccount-length", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ subaccountLength: value }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar la longitud de las subcuentas."));
      toast.success(`Subcuentas de ${value} dígitos.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar la longitud de las subcuentas.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="company-subaccount-length">Dígitos de las subcuentas</Label>
          <Select
            className="w-32"
            disabled={locked || pending}
            id="company-subaccount-length"
            onChange={(event) => setValue(Number(event.currentTarget.value))}
            value={String(value)}
          >
            {LENGTHS.map((length) => <option key={length} value={length}>{length} dígitos</option>)}
          </Select>
        </div>
        {!locked ? (
          <Button disabled={pending || value === initialValue} onClick={() => void save()} type="button" variant="outline">
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Ejemplo: el primer cliente será la subcuenta {example("430")} y el IVA repercutido {"477".padEnd(value, "0")}.{" "}
        {locked ? "La empresa ya tiene asientos: la longitud no se puede cambiar." : "Solo se puede cambiar antes del primer asiento."}
      </p>
    </div>
  );
}
