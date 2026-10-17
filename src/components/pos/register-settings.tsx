"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";

export type RegisterRow = {
  id: string;
  name: string;
  seriesCode: string;
  seriesPrefix: string;
  warehouseId: string | null;
  cardBankAccountId: string | null;
  simplifiedLimit: number;
  isActive: boolean;
  mode: "COUNTER" | "TABLES";
};

type Option = { id: string; name: string };

/** Alta y edición de una caja del TPV. */
export function RegisterForm({ bankAccounts, hospitalityEnabled = false, initial, inventoryEnabled, onDone, warehouses }: { bankAccounts: Option[]; hospitalityEnabled?: boolean; initial?: RegisterRow; inventoryEnabled: boolean; onDone?: () => void; warehouses: Option[] }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? (initial ? "" : "Mostrador"));
  const [seriesCode, setSeriesCode] = useState(initial?.seriesCode ?? "T");
  const [seriesPrefix, setSeriesPrefix] = useState(initial?.seriesPrefix ?? "T");
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? warehouses[0]?.id ?? "");
  const [cardBankAccountId, setCardBankAccountId] = useState(initial?.cardBankAccountId ?? bankAccounts[0]?.id ?? "");
  const [limit, setLimit] = useState(String(initial?.simplifiedLimit ?? 400).replace(".", ","));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [mode, setMode] = useState<"COUNTER" | "TABLES">(initial?.mode ?? (hospitalityEnabled ? "TABLES" : "COUNTER"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const simplifiedLimit = parseDecimalInput(limit, { maximumFractionDigits: 2 });
    if (simplifiedLimit === null) return setError("Límite no válido.");
    setPending(true);
    setError(null);
    try {
      const response = await fetch(initial ? `/api/pos/registers/${initial.id}` : "/api/pos/registers", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ name, seriesCode, seriesPrefix, warehouseId: inventoryEnabled ? warehouseId || null : null, cardBankAccountId: cardBankAccountId || null, simplifiedLimit, isActive, mode: hospitalityEnabled ? mode : "COUNTER" }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la caja."));
      toast.success(initial ? "Caja guardada." : "Caja creada.");
      onDone?.();
      router.refresh();
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo guardar la caja."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-3 md:grid-cols-2" data-testid="pos-register-form" noValidate onSubmit={submit}>
      <AccessibleField id={`register-name-${initial?.id ?? "new"}`} label="Nombre de la caja" required><Input maxLength={60} onChange={(event) => setName(event.target.value)} value={name} /></AccessibleField>
      {hospitalityEnabled ? (
        <AccessibleField helperText="Mesas: plano de mesas con cuenta abierta (bar o restaurante). Mostrador: se cobra cada ticket al momento." id={`register-mode-${initial?.id ?? "new"}`} label="Cómo se vende">
          <Select onChange={(event) => setMode(event.target.value as "COUNTER" | "TABLES")} value={mode}>
            <option value="TABLES">Mesas (hostelería)</option>
            <option value="COUNTER">Mostrador</option>
          </Select>
        </AccessibleField>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <AccessibleField helperText="Serie propia de los tickets." id={`register-series-${initial?.id ?? "new"}`} label="Código de serie"><Input maxLength={10} onChange={(event) => setSeriesCode(event.target.value.toUpperCase())} value={seriesCode} /></AccessibleField>
        <AccessibleField helperText="Así empiezan los números: T000001." id={`register-prefix-${initial?.id ?? "new"}`} label="Prefijo"><Input maxLength={12} onChange={(event) => setSeriesPrefix(event.target.value)} value={seriesPrefix} /></AccessibleField>
      </div>
      {inventoryEnabled ? (
        <AccessibleField helperText="De aquí se descuenta el stock de lo vendido." id={`register-warehouse-${initial?.id ?? "new"}`} label="Almacén">
          <Select onChange={(event) => setWarehouseId(event.target.value)} value={warehouseId}>
            <option value="">Sin descontar stock</option>
            {warehouses.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </Select>
        </AccessibleField>
      ) : null}
      <AccessibleField helperText={bankAccounts.length === 0 ? "Añade una cuenta bancaria para cobrar con tarjeta." : "Banco donde se abonan los cobros con tarjeta (datáfono)."} id={`register-card-${initial?.id ?? "new"}`} label="Cobro con tarjeta">
        <Select disabled={bankAccounts.length === 0} onChange={(event) => setCardBankAccountId(event.target.value)} value={cardBankAccountId}>
          <option value="">Sin tarjeta (solo efectivo)</option>
          {bankAccounts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField helperText="Por encima hay que identificar al cliente con su NIF (factura completa). 400 € en general; hasta 3.000 € en comercio minorista." id={`register-limit-${initial?.id ?? "new"}`} label="Límite de factura simplificada">
        <MoneyInput onChange={(event) => setLimit(event.target.value)} value={limit} />
      </AccessibleField>
      {initial ? (
        <label className="flex items-center gap-2 text-sm"><input checked={isActive} onChange={(event) => setIsActive(event.target.checked)} type="checkbox" /> Caja activa</label>
      ) : null}
      {error ? <FormErrorMessage className="md:col-span-2">{error}</FormErrorMessage> : null}
      <div className="flex gap-2 md:col-span-2">
        <SubmitButton data-testid="pos-register-save" pending={pending}>{initial ? "Guardar caja" : "Crear caja"}</SubmitButton>
        {onDone ? <Button onClick={onDone} type="button" variant="ghost">Cancelar</Button> : null}
      </div>
    </form>
  );
}

/** Lista de cajas con su edición en línea. */
export function RegisterList({ bankAccounts, hospitalityEnabled = false, inventoryEnabled, registers, warehouses }: { bankAccounts: Option[]; hospitalityEnabled?: boolean; inventoryEnabled: boolean; registers: Array<RegisterRow & { warehouseName: string | null; hasCard: boolean }>; warehouses: Option[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (registers.length === 0) return <p className="text-sm text-muted-foreground">Aún no hay cajas.</p>;
  return (
    <ul className="space-y-2">
      {registers.map((register) => (
        <li className="border border-window-shadow bg-card p-2" key={register.id}>
          {editing === register.id ? (
            <RegisterForm bankAccounts={bankAccounts} hospitalityEnabled={hospitalityEnabled} initial={register} inventoryEnabled={inventoryEnabled} onDone={() => setEditing(null)} warehouses={warehouses} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <strong className="font-mono">{register.name}</strong>{!register.isActive ? <span className="ml-1 text-xs text-muted-foreground">(desactivada)</span> : null}
                <span className="block text-xs text-muted-foreground">
                  {hospitalityEnabled ? (register.mode === "TABLES" ? "Mesas · " : "Mostrador · ") : ""}Serie {register.seriesCode} ({register.seriesPrefix}…) · {register.hasCard ? "efectivo y tarjeta" : "solo efectivo"}{register.warehouseName ? ` · stock de ${register.warehouseName}` : ""} · simplificada hasta {register.simplifiedLimit.toLocaleString("es-ES")} €
                </span>
              </span>
              <Button onClick={() => setEditing(register.id)} size="sm" type="button" variant="outline">Editar</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
