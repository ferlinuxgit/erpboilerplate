"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
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
type MethodFieldErrors = Partial<Record<"code" | "name" | "bankAccountNumber", string>>;

const initialDraft = {
  code: "",
  name: "",
  type: "BANK_TRANSFER" as PaymentMethodType,
  bankAccountId: "",
  bankAccountNumber: "",
  isDefault: false,
};

function validateMethod(values: { code: string; name: string; bankAccountNumber?: string | null }, { requireCode = true } = {}) {
  const errors: MethodFieldErrors = {};
  if (requireCode && !values.code.trim()) errors.code = "Indica un código corto (por ejemplo, TRANSF).";
  else if (values.code.trim().length > 80) errors.code = "El código no puede superar 80 caracteres.";
  if (!values.name.trim()) errors.name = "Indica el nombre que verá el cliente en la factura.";
  else if (values.name.trim().length > 160) errors.name = "El nombre no puede superar 160 caracteres.";
  if ((values.bankAccountNumber ?? "").trim().length > 80) errors.bankAccountNumber = "El número de cuenta no puede superar 80 caracteres.";
  return errors;
}

async function fetchPaymentConfiguration() {
  const [methodsResponse, accountsResponse] = await Promise.all([
    fetch("/api/payment-methods"),
    fetch("/api/bank-accounts"),
  ]);
  if (!methodsResponse.ok) throw new Error(await readApiError(methodsResponse, "No se pudieron cargar las formas de pago."));
  const methodRows = await methodsResponse.json() as PaymentMethodRow[];
  const accountRows = accountsResponse.ok ? await accountsResponse.json() as BankAccountOption[] : [];
  return { methodRows, accountRows };
}

export function PaymentMethodsPanel() {
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [draft, setDraft] = useState(initialDraft);
  const [draftErrors, setDraftErrors] = useState<MethodFieldErrors>({});
  const [rowErrors, setRowErrors] = useState<Record<string, MethodFieldErrors>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PaymentMethodRow | null>(null);

  const load = useCallback(async () => {
    try {
      const { methodRows, accountRows } = await fetchPaymentConfiguration();
      setMethods(methodRows);
      setBankAccounts(accountRows);
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo cargar la configuración de cobros."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function initialLoad() {
      try {
        const { methodRows, accountRows } = await fetchPaymentConfiguration();
        if (ignore) return;
        setMethods(methodRows);
        setBankAccounts(accountRows);
      } catch (error) {
        if (!ignore) toast.error(errorMessage(error, "No se pudo cargar la configuración de cobros."));
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void initialLoad();
    return () => { ignore = true; };
  }, []);

  const request = async (url: string, method: "POST" | "PATCH" | "DELETE", fallback: string, payload?: unknown) => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...getCsrfHeader() },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    if (!response.ok) throw new Error(await readApiError(response, fallback));
  };

  const setFormError = (key: string, message: string | null) => setFormErrors((current) => ({ ...current, [key]: message }));

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("new", null);
    const errors = validateMethod(draft);
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Revisa los campos marcados de la nueva forma de pago.");
      return;
    }
    setSavingId("new");
    try {
      await request("/api/payment-methods", "POST", "No se pudo crear la forma de pago.", draft);
      setDraft(initialDraft);
      await load();
      toast.success(`Forma de pago «${draft.name.trim()}» creada.`);
    } catch (error) {
      const message = errorMessage(error, "No se pudo crear la forma de pago.");
      setFormError("new", message);
      toast.error(message);
    } finally {
      setSavingId(null);
    }
  };

  const updateRow = (id: string, patch: Partial<PaymentMethodRow>) => {
    setMethods((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const save = async (event: React.FormEvent<HTMLFormElement>, row: PaymentMethodRow) => {
    event.preventDefault();
    setFormError(row.id, null);
    const errors = validateMethod(row, { requireCode: !row.bankAccountId });
    setRowErrors((current) => ({ ...current, [row.id]: errors }));
    if (Object.keys(errors).length > 0) {
      toast.error(`Revisa los campos marcados de «${row.name || row.code}».`);
      return;
    }
    setSavingId(row.id);
    try {
      await request(`/api/payment-methods/${row.id}`, "PATCH", "No se pudo actualizar la forma de pago.", row);
      await load();
      toast.success(`Forma de pago «${row.name.trim()}» actualizada.`);
    } catch (error) {
      const message = errorMessage(error, "No se pudo actualizar la forma de pago.");
      setFormError(row.id, message);
      toast.error(message);
    } finally {
      setSavingId(null);
    }
  };

  const confirmRemove = async () => {
    const row = pendingDelete;
    if (!row) return;
    setSavingId(row.id);
    setFormError("delete", null);
    try {
      await request(`/api/payment-methods/${row.id}`, "DELETE", "No se pudo eliminar la forma de pago.");
      setPendingDelete(null);
      await load();
      toast.success(`Forma de pago «${row.name}» eliminada.`);
    } catch (error) {
      const message = errorMessage(error, "No se pudo eliminar la forma de pago.");
      setFormError("delete", message);
      toast.error(message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="font-mono text-sm font-bold">Formas de pago</h3>
        <p className="text-xs text-muted-foreground">
          La predeterminada se selecciona automáticamente en facturas nuevas. Cada cuenta bancaria de Tesorería aparece como transferencia disponible.
        </p>
      </div>

      <form
        aria-labelledby="payment-method-new-title"
        className="grid gap-2 border border-window-dark-shadow bg-window-panel p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight)] md:grid-cols-12"
        noValidate
        onSubmit={create}
      >
        <p className="font-mono text-xs font-bold md:col-span-12" id="payment-method-new-title">Nueva forma de pago</p>
        <AccessibleField className="md:col-span-2" error={draftErrors.code} id="payment-method-new-code" label="Código" required>
          <Input id="payment-method-new-code" className="font-mono" value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} />
        </AccessibleField>
        <AccessibleField className="md:col-span-3" error={draftErrors.name} helperText="Texto que se imprime en la factura." id="payment-method-new-name" label="Nombre visible" required>
          <Input id="payment-method-new-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </AccessibleField>
        <AccessibleField className="md:col-span-2" id="payment-method-new-type" label="Tipo" required>
          <Select id="payment-method-new-type" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as PaymentMethodType, bankAccountId: event.target.value === "BANK_TRANSFER" ? current.bankAccountId : "", bankAccountNumber: event.target.value === "BANK_TRANSFER" ? current.bankAccountNumber : "" }))}>
            {Object.entries(paymentMethodTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </AccessibleField>
        {draft.type === "BANK_TRANSFER" ? (
          <AccessibleField className="md:col-span-3" helperText="Elige una cuenta de Tesorería o escribe el IBAN a mano." id="payment-method-new-bank-account" label="Cuenta bancaria">
            <Select id="payment-method-new-bank-account" value={draft.bankAccountId} onChange={(event) => setDraft((current) => ({ ...current, bankAccountId: event.target.value, bankAccountNumber: event.target.value ? "" : current.bankAccountNumber }))}>
              <option value="">Cuenta manual</option>
              {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.iban}</option>)}
            </Select>
          </AccessibleField>
        ) : <div className="md:col-span-3" />}
        <label className="flex items-center gap-2 self-end pb-2 font-mono text-xs font-bold md:col-span-2" htmlFor="payment-method-new-default">
          <input checked={draft.isDefault} id="payment-method-new-default" type="checkbox" onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))} />
          Predeterminada
        </label>
        {draft.type === "BANK_TRANSFER" && !draft.bankAccountId ? (
          <AccessibleField className="md:col-span-5" error={draftErrors.bankAccountNumber} id="payment-method-new-account-number" label="Número de cuenta manual">
            <Input id="payment-method-new-account-number" className="font-mono" placeholder="ES00 0000 0000 0000 0000 0000" value={draft.bankAccountNumber} onChange={(event) => setDraft((current) => ({ ...current, bankAccountNumber: event.target.value }))} />
          </AccessibleField>
        ) : null}
        <div className="flex items-end justify-end md:col-span-12">
          <SubmitButton pending={savingId === "new"} disabled={savingId !== null}>
            Crear
          </SubmitButton>
        </div>
        <FormErrorMessage className="md:col-span-12">{formErrors.new}</FormErrorMessage>
      </form>

      <div className="divide-y divide-window-shadow border border-window-dark-shadow bg-card">
        {methods.map((row) => {
          const linkedAccount = Boolean(row.bankAccountId);
          const errors = rowErrors[row.id] ?? {};
          const baseId = `payment-method-${row.id}`;
          return (
            <form className="grid gap-2 p-2.5 md:grid-cols-12" key={row.id} noValidate onSubmit={(event) => void save(event, row)}>
              {linkedAccount ? (
                <div className="flex items-center md:col-span-2"><StatusBadge tone="info">Tesorería</StatusBadge></div>
              ) : (
                <AccessibleField className="md:col-span-2" error={errors.code} id={`${baseId}-code`} label="Código" required>
                  <Input id={`${baseId}-code`} aria-label={`Código ${row.name}`} className="font-mono" value={row.code} onChange={(event) => updateRow(row.id, { code: event.target.value })} />
                </AccessibleField>
              )}
              <AccessibleField className="md:col-span-3" error={errors.name} id={`${baseId}-name`} label="Nombre" required>
                <Input id={`${baseId}-name`} aria-label={`Nombre ${row.name}`} value={row.name} onChange={(event) => updateRow(row.id, { name: event.target.value })} />
              </AccessibleField>
              <AccessibleField className="md:col-span-2" id={`${baseId}-type`} label="Tipo" required>
                <Select id={`${baseId}-type`} aria-label={`Tipo ${row.name}`} disabled={linkedAccount} value={row.type} onChange={(event) => updateRow(row.id, { type: event.target.value as PaymentMethodType, bankAccountId: event.target.value === "BANK_TRANSFER" ? row.bankAccountId : null, bankAccountNumber: event.target.value === "BANK_TRANSFER" ? row.bankAccountNumber : null })}>
                  {Object.entries(paymentMethodTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </AccessibleField>
              {row.type === "BANK_TRANSFER" ? (
                linkedAccount ? (
                  <div className="flex items-center md:col-span-3">
                    <StatusBadge tone="info">{row.bankAccountNumber || "Cuenta bancaria"}</StatusBadge>
                  </div>
                ) : (
                  <AccessibleField className="md:col-span-3" error={errors.bankAccountNumber} id={`${baseId}-account-number`} label="Número de cuenta">
                    <Input id={`${baseId}-account-number`} aria-label={`Número de cuenta ${row.name}`} className="font-mono" placeholder="IBAN o número de cuenta" value={row.bankAccountNumber ?? ""} onChange={(event) => updateRow(row.id, { bankAccountNumber: event.target.value })} />
                  </AccessibleField>
                )
              ) : <div className="md:col-span-3" />}
              <label className="flex items-center gap-2 self-end pb-2 font-mono text-xs font-bold md:col-span-2" htmlFor={`${baseId}-default`}>
                <input checked={row.isDefault} id={`${baseId}-default`} type="checkbox" onChange={(event) => updateRow(row.id, { isDefault: event.target.checked })} />
                Predeterminada<span className="sr-only"> {row.name}</span>
              </label>
              <div className="flex flex-wrap items-center justify-end gap-2 md:col-span-12">
                {linkedAccount ? <span className="mr-auto text-xs text-muted-foreground">Sincronizada con Tesorería</span> : null}
                <SubmitButton disabled={savingId !== null} pending={savingId === row.id && pendingDelete === null} size="sm" variant="outline">Guardar</SubmitButton>
                {!linkedAccount ? (
                  <Button disabled={savingId !== null} size="sm" type="button" variant="ghost" onClick={() => { setFormError("delete", null); setPendingDelete(row); }}>
                    Eliminar
                  </Button>
                ) : null}
              </div>
              <FormErrorMessage className="md:col-span-12">{formErrors[row.id]}</FormErrorMessage>
            </form>
          );
        })}
        {!loading && methods.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            No hay formas de pago configuradas. Crea la primera con el formulario de arriba o añade una cuenta bancaria en Tesorería.
          </p>
        ) : null}
        {loading ? <p className="p-3 text-xs text-muted-foreground" aria-busy="true">Cargando formas de pago…</p> : null}
      </div>

      <DestructiveActionDialog
        confirmLabel="Eliminar forma de pago"
        description={pendingDelete ? `Se eliminará «${pendingDelete.name}». Las facturas emitidas conservarán sus datos.` : ""}
        errorMessage={formErrors.delete}
        isSubmitting={pendingDelete !== null && savingId === pendingDelete.id}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmRemove}
        open={pendingDelete !== null}
        title="Eliminar forma de pago"
      />
    </div>
  );
}
