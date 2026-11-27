"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessibleField, errorMessage, readApiError, SubmitButton } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import type { PayrollSettingsValues } from "@/server/payroll/withholding-data";

const OPTIONAL_MODELS = [
  { code: "190", label: "190 · Resumen anual de retenciones (nóminas y profesionales)" },
  { code: "180", label: "180 · Resumen anual de alquileres" },
  { code: "123", label: "123 · Retenciones de dividendos e intereses" },
  { code: "193", label: "193 · Resumen anual del capital mobiliario" },
];

/** Criterio de imputación de las retenciones y modelos que se quieren ver en el calendario sin datos. */
export function WithholdingSettingsForm({ initialValues, canWrite }: { initialValues: PayrollSettingsValues; canWrite: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/payroll/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron guardar los ajustes."));
      toast.success("Ajustes de retenciones guardados.");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudieron guardar los ajustes."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <AccessibleField
        helperText="La obligación de retener nace al pagar (art. 78 del Reglamento del IRPF). Por fecha de pago, una factura sin pago registrado se queda en su fecha de registro con un aviso."
        id="settings-invoice-basis"
        label="Facturas de profesionales y alquileres (111 y 115)"
      >
        <Select disabled={!canWrite} onChange={(event) => setValues((current) => ({ ...current, invoiceWithholdingBasis: event.target.value === "payment" ? "payment" : "registration" }))} value={values.invoiceWithholdingBasis}>
          <option value="registration">Por fecha de registro de la factura (como hasta ahora)</option>
          <option value="payment">Por fecha de pago de la factura</option>
        </Select>
      </AccessibleField>
      <AccessibleField
        helperText="Por devengo, la nómina de diciembre va al cuarto trimestre aunque se pague en enero. Por pago, va al periodo en que registras su pago."
        id="settings-payroll-basis"
        label="Nóminas (111)"
      >
        <Select disabled={!canWrite} onChange={(event) => setValues((current) => ({ ...current, payrollWithholdingBasis: event.target.value === "payment" ? "payment" : "accrual" }))} value={values.payrollWithholdingBasis}>
          <option value="accrual">Por el mes de la nómina (devengo)</option>
          <option value="payment">Por fecha de pago de la nómina</option>
        </Select>
      </AccessibleField>
      <fieldset className="space-y-1 md:col-span-2">
        <legend className="text-sm font-medium">Mostrar en el calendario fiscal aunque no haya datos</legend>
        <p className="text-xs text-muted-foreground">Estos modelos aparecen solos cuando hay nóminas, alquileres o dividendos registrados. Márcalos si quieres verlos siempre.</p>
        {OPTIONAL_MODELS.map((model) => (
          <label className="flex w-fit items-center gap-2 text-sm" key={model.code}>
            <input
              checked={values.enabledModels.includes(model.code)}
              disabled={!canWrite}
              onChange={(event) => setValues((current) => ({
                ...current,
                enabledModels: event.target.checked ? [...new Set([...current.enabledModels, model.code])] : current.enabledModels.filter((code) => code !== model.code),
              }))}
              type="checkbox"
            />
            {model.label}
          </label>
        ))}
      </fieldset>
      {error ? <InlineAlert className="md:col-span-2" role="alert" tone="danger">{error}</InlineAlert> : null}
      {canWrite ? (
        <div className="md:col-span-2">
          <SubmitButton pending={pending}>Guardar ajustes</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
