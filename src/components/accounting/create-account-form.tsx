"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AccountPicker } from "@/components/ui/account-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { accountTypeLabels, statusLabel } from "@/lib/status-labels";

const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "MIXED"] as const;
type AccountType = (typeof accountTypes)[number];

export type ParentAccountOption = { id: string; code: string; name: string; type: AccountType };

type CreateAccountFormProps = {
  onCancel?: () => void;
  onSuccess?: () => void;
  /** Por defecto vuelve al plan contable con la cuenta creada seleccionada. */
  redirectHref?: string;
  /** Cuentas de grupo elegibles como padre. */
  parentOptions?: readonly ParentAccountOption[];
  defaultParentCode?: string | null;
  subaccountLength?: number;
};

function isAccountType(value: string): value is AccountType {
  return accountTypes.some((type) => type === value);
}

/**
 * Alta de cuenta: se puede elegir la cuenta padre y el formulario propone la siguiente subcuenta
 * libre (430 → 43000013). Al guardar vuelve al plan contable con la cuenta seleccionada.
 */
export function CreateAccountForm({ defaultParentCode, onCancel, onSuccess, parentOptions = [], redirectHref, subaccountLength = 8 }: CreateAccountFormProps = {}) {
  const router = useRouter();
  const initialParent = parentOptions.find((option) => option.code === defaultParentCode) ?? null;
  const [parentId, setParentId] = useState(initialParent?.id ?? "");
  const [suggestion, setSuggestion] = useState<{ parentCode: string; code: string | null } | null>(null);
  const [code, setCode] = useState("");
  // Mientras el usuario no escriba el código, se rellena con la subcuenta propuesta.
  const codeTouchedRef = useRef(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>(initialParent?.type ?? "ASSET");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parent = parentOptions.find((option) => option.id === parentId) ?? null;
  const example = `${"43".padEnd(subaccountLength - 2, "0")}12`;

  // Siguiente subcuenta libre de la cuenta padre elegida.
  useEffect(() => {
    if (!parent) return;
    const controller = new AbortController();
    fetch(`/api/accounts/next-code?parent=${encodeURIComponent(parent.code)}`, { signal: controller.signal })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: { parentCode: string; code: string | null } | null) => {
        if (!payload) return;
        setSuggestion(payload);
        if (payload.code && !codeTouchedRef.current) setCode(payload.code);
      })
      .catch(() => {
        // Sin propuesta: el usuario escribe el código a mano.
      });
    return () => controller.abort();
  }, [parent]);

  const activeSuggestion = parent && suggestion?.parentCode === parent.code ? suggestion.code : null;

  return (
    <form className="grid gap-3 md:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault();
      setLoading(true); setError(null);
      try {
        const res = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ code, name, type }) });
        if (!res.ok) throw new Error(await readApiError(res, "No se pudo crear la cuenta."));
        const created: { code?: string } = await res.json();
        toast.success(`Cuenta ${code} creada.`);
        setCode(""); setName(""); setType("ASSET");
        if (onSuccess) {
          onSuccess();
        } else {
          router.push(redirectHref ?? `/accounting/accounts?sel=${encodeURIComponent(created.code ?? code)}`);
        }
      } catch (e) { setError(errorMessage(e, "No se pudo crear la cuenta.")); } finally { setLoading(false); }
    }}>
      {parentOptions.length > 0 ? (
        <AccessibleField className="md:col-span-2" helperText="Opcional. Al elegirla se propone la siguiente subcuenta libre y su tipo." id="account-parent" label="Cuenta padre">
          <AccountPicker
            accounts={parentOptions}
            id="account-parent"
            onChange={(accountId, account) => {
              setParentId(accountId);
              const option = parentOptions.find((entry) => entry.id === account?.id);
              if (option) setType(option.type);
            }}
            placeholder="Busca la cuenta de grupo (p. ej. 430, 572, 629)"
            recentKey="account-parent"
            value={parentId}
          />
        </AccessibleField>
      ) : null}
      <AccessibleField
        id="account-code"
        label="Código"
        required
        helperText={`Subcuenta de ${subaccountLength} dígitos (p. ej. ${example}) para apuntar en ella; un código más corto (p. ej. 629) crea la cuenta de grupo y su subcuenta ${"629".padEnd(subaccountLength, "0")}.`}
      >
        <Input id="account-code" inputMode="numeric" value={code} onChange={(e) => { codeTouchedRef.current = e.target.value !== ""; setCode(e.target.value.replace(/\s/g, "")); }} placeholder={example} required />
      </AccessibleField>
      <AccessibleField id="account-name" label="Nombre" required><Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={parent ? parent.name : "Clientes"} required /></AccessibleField>
      {activeSuggestion && activeSuggestion !== code ? (
        <p className="text-xs md:col-span-2">
          Siguiente subcuenta libre de {parent?.code}: <span className="font-mono font-bold">{activeSuggestion}</span>{" "}
          <Button onClick={() => setCode(activeSuggestion)} size="xs" type="button" variant="outline">Usar {activeSuggestion}</Button>
        </p>
      ) : null}
      <AccessibleField id="account-type" label="Tipo" required><Select id="account-type" value={type} onChange={(e) => { if (isAccountType(e.target.value)) setType(e.target.value); }}>{accountTypes.map((option) => <option key={option} value={option}>{statusLabel(accountTypeLabels, option)}</option>)}</Select></AccessibleField>
      <div className="flex gap-2 self-end md:justify-end">{onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button> : null}<Button type="submit" disabled={loading}>{loading ? "Guardando…" : "Crear cuenta"}</Button></div>
      {error ? <InlineAlert className="md:col-span-2" role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}
