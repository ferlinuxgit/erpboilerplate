"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";
import { paymentMethodTypeLabels, type PaymentMethodType } from "@/lib/payment-methods";

type BankAccountOption = { id: string; bankName: string; iban: string };
type PaymentMethodRow = {
  id: string;
  bankAccountId: string | null;
  code: string;
  name: string;
  type: PaymentMethodType;
  bankAccountNumber: string | null;
  isDefault: boolean;
};

const initialDraft = {
  code: "",
  name: "",
  type: "BANK_TRANSFER" as PaymentMethodType,
  bankAccountId: "",
  bankAccountNumber: "",
  isDefault: false,
};

export function PaymentMethodsPanel() {
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [draft, setDraft] = useState(initialDraft);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [methodsResponse, accountsResponse] = await Promise.all([
        fetch("/api/payment-methods"),
        fetch("/api/bank-accounts"),
      ]);
      if (!methodsResponse.ok) throw new Error("No se pudieron cargar las formas de pago.");
      const methodRows = await methodsResponse.json() as PaymentMethodRow[];
      const accountRows = accountsResponse.ok ? await accountsResponse.json() as BankAccountOption[] : [];
      setMethods(methodRows);
      setBankAccounts(accountRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la configuración de cobros.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function initialLoad() {
      try {
        const [methodsResponse, accountsResponse] = await Promise.all([
          fetch("/api/payment-methods"),
          fetch("/api/bank-accounts"),
        ]);
        if (!methodsResponse.ok) throw new Error("No se pudieron cargar las formas de pago.");
        const methodRows = await methodsResponse.json() as PaymentMethodRow[];
        const accountRows = accountsResponse.ok ? await accountsResponse.json() as BankAccountOption[] : [];
        if (ignore) return;
        setMethods(methodRows);
        setBankAccounts(accountRows);
      } catch (error) {
        if (!ignore) toast.error(error instanceof Error ? error.message : "No se pudo cargar la configuración de cobros.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void initialLoad();
    return () => { ignore = true; };
  }, []);

  const request = async (url: string, method: "POST" | "PATCH" | "DELETE", payload?: unknown) => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...getCsrfHeader() },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? "No se pudo guardar.");
    }
  };

  const create = async () => {
    setSavingId("new");
    try {
      await request("/api/payment-methods", "POST", draft);
      setDraft(initialDraft);
      await load();
      toast.success("Forma de pago creada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la forma de pago.");
    } finally {
      setSavingId(null);
    }
  };

  const updateRow = (id: string, patch: Partial<PaymentMethodRow>) => {
    setMethods((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const save = async (row: PaymentMethodRow) => {
    setSavingId(row.id);
    try {
      await request(`/api/payment-methods/${row.id}`, "PATCH", row);
      await load();
      toast.success("Forma de pago actualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la forma de pago.");
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (row: PaymentMethodRow) => {
    if (!window.confirm(`¿Eliminar la forma de pago “${row.name}”? Las facturas emitidas conservarán sus datos.`)) return;
    setSavingId(row.id);
    try {
      await request(`/api/payment-methods/${row.id}`, "DELETE");
      await load();
      toast.success("Forma de pago eliminada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la forma de pago.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">Formas de pago</p>
        <p className="text-sm text-muted-foreground">
          La predeterminada se selecciona automáticamente en facturas nuevas. Cada cuenta bancaria de Tesorería aparece como transferencia disponible.
        </p>
      </div>

      <div className="grid gap-2 rounded-md border bg-muted/20 p-3 md:grid-cols-12">
        <Input className="md:col-span-2" aria-label="Código de la nueva forma de pago" placeholder="Código" value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} />
        <Input className="md:col-span-3" aria-label="Nombre de la nueva forma de pago" placeholder="Nombre visible" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        <Select className="md:col-span-2" aria-label="Tipo de la nueva forma de pago" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as PaymentMethodType, bankAccountId: event.target.value === "BANK_TRANSFER" ? current.bankAccountId : "", bankAccountNumber: event.target.value === "BANK_TRANSFER" ? current.bankAccountNumber : "" }))}>
          {Object.entries(paymentMethodTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {draft.type === "BANK_TRANSFER" ? (
          <Select className="md:col-span-3" aria-label="Cuenta bancaria de la nueva forma de pago" value={draft.bankAccountId} onChange={(event) => setDraft((current) => ({ ...current, bankAccountId: event.target.value, bankAccountNumber: event.target.value ? "" : current.bankAccountNumber }))}>
            <option value="">Cuenta manual</option>
            {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.iban}</option>)}
          </Select>
        ) : <div className="md:col-span-3" />}
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input checked={draft.isDefault} type="checkbox" onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))} />
          Predeterminada
        </label>
        {draft.type === "BANK_TRANSFER" && !draft.bankAccountId ? (
          <Input className="md:col-span-5 md:col-start-6" aria-label="Número de cuenta manual" placeholder="IBAN o número de cuenta" value={draft.bankAccountNumber} onChange={(event) => setDraft((current) => ({ ...current, bankAccountNumber: event.target.value }))} />
        ) : null}
        <Button className="md:col-span-2 md:col-start-11" disabled={savingId !== null || !draft.code.trim() || !draft.name.trim()} type="button" onClick={create}>
          Crear
        </Button>
      </div>

      <div className="divide-y rounded-md border">
        {methods.map((row) => {
          const linkedAccount = Boolean(row.bankAccountId);
          return (
            <div className="grid gap-2 p-3 md:grid-cols-12" key={row.id}>
              {linkedAccount ? (
                <div className="flex items-center md:col-span-2"><StatusBadge tone="info">Tesorería</StatusBadge></div>
              ) : (
                <Input className="md:col-span-2" aria-label={`Código ${row.name}`} value={row.code} onChange={(event) => updateRow(row.id, { code: event.target.value })} />
              )}
              <Input className="md:col-span-3" aria-label={`Nombre ${row.name}`} value={row.name} onChange={(event) => updateRow(row.id, { name: event.target.value })} />
              <Select className="md:col-span-2" aria-label={`Tipo ${row.name}`} disabled={linkedAccount} value={row.type} onChange={(event) => updateRow(row.id, { type: event.target.value as PaymentMethodType, bankAccountId: event.target.value === "BANK_TRANSFER" ? row.bankAccountId : null, bankAccountNumber: event.target.value === "BANK_TRANSFER" ? row.bankAccountNumber : null })}>
                {Object.entries(paymentMethodTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
              {row.type === "BANK_TRANSFER" ? (
                linkedAccount ? (
                  <div className="flex items-center md:col-span-3">
                    <StatusBadge tone="info">{row.bankAccountNumber || "Cuenta bancaria"}</StatusBadge>
                  </div>
                ) : (
                  <Input className="md:col-span-3" aria-label={`Número de cuenta ${row.name}`} placeholder="IBAN o número de cuenta" value={row.bankAccountNumber ?? ""} onChange={(event) => updateRow(row.id, { bankAccountNumber: event.target.value })} />
                )
              ) : <div className="md:col-span-3" />}
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input checked={row.isDefault} type="checkbox" onChange={(event) => updateRow(row.id, { isDefault: event.target.checked })} />
                Predeterminada
              </label>
              <div className="flex flex-wrap justify-end gap-2 md:col-span-12">
                {linkedAccount ? <span className="self-center text-xs text-muted-foreground">Sincronizada con Tesorería</span> : null}
                <Button disabled={savingId !== null} size="sm" type="button" variant="outline" onClick={() => save(row)}>Guardar</Button>
                {!linkedAccount ? <Button disabled={savingId !== null} size="sm" type="button" variant="ghost" onClick={() => remove(row)}>Eliminar</Button> : null}
              </div>
            </div>
          );
        })}
        {!loading && methods.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No hay formas de pago configuradas.</p> : null}
        {loading ? <p className="p-3 text-sm text-muted-foreground">Cargando formas de pago…</p> : null}
      </div>
    </div>
  );
}
