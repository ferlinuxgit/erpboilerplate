"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

type Role = "customer" | "supplier" | "sales" | "purchase" | "bank";
type Accounts = Record<Role, string>;

const fields: Array<{ role: Role; label: string; help: string }> = [
  { role: "sales", label: "Ventas", help: "Ingresos de tus facturas (700 mercaderías, 705 servicios)." },
  { role: "purchase", label: "Compras y gastos", help: "Gastos sin cuenta propia (600 compras, 629 otros servicios)." },
  { role: "customer", label: "Clientes", help: "De ella cuelga la subcuenta de cada cliente." },
  { role: "supplier", label: "Proveedores", help: "De ella cuelga la subcuenta de cada proveedor." },
  { role: "bank", label: "Bancos", help: "Para cobros y pagos sin cuenta bancaria vinculada." },
];

/**
 * Cuentas de la contabilidad automática. En cuanto hay asientos se muestran en solo lectura:
 * cambiarlas repartiría los saldos entre dos cuentas.
 */
export function DefaultAccountsForm({ initialValues, accountNames, locked }: { initialValues: Accounts; accountNames: Record<string, string>; locked: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = fields.some(({ role }) => values[role].trim() !== initialValues[role]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/accounting/default-accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron guardar las cuentas por defecto."));
      toast.success("Cuentas por defecto guardadas.");
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudieron guardar las cuentas por defecto.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-2" noValidate onSubmit={submit}>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {fields.map(({ role, label, help }) => {
          const name = accountNames[values[role].trim()];
          return (
            <AccessibleField helperText={name ? `${name}. ${help}` : help} id={`default-account-${role}`} key={role} label={label}>
              <Input
                className="font-mono"
                inputMode="numeric"
                onChange={(event) => setValues((current) => ({ ...current, [role]: event.target.value }))}
                readOnly={locked}
                value={values[role]}
              />
            </AccessibleField>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {locked
            ? "La empresa ya tiene asientos: estas cuentas no se pueden cambiar. Para un gasto o venta concretos, elige otra cuenta en el propio documento."
            : "Solo se pueden cambiar antes del primer asiento. Las cuentas tienen que existir en tu plan contable."}
        </p>
        {!locked ? <SubmitButton disabled={!dirty} pending={pending} variant="outline">Guardar cuentas</SubmitButton> : null}
      </div>
      <FormErrorMessage>{error}</FormErrorMessage>
    </form>
  );
}
