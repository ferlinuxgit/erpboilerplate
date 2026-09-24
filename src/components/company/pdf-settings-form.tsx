"use client";

import { FilePdf, FloppyDisk as Save } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { FormActions, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";
import type { PdfDisplaySettings } from "@/lib/pdf-settings";

const options: Array<{ key: keyof PdfDisplaySettings; label: string; description: string }> = [
  { key: "showLogo", label: "Mostrar logotipo", description: "Usa el logotipo del perfil en la cabecera." },
  { key: "showEmail", label: "Mostrar email", description: "Incluye el email público en cabecera y emisor." },
  { key: "showPhone", label: "Mostrar teléfono", description: "Incluye el teléfono público en cabecera y emisor." },
  { key: "showWebsite", label: "Mostrar web", description: "Incluye la dirección web de la empresa." },
  { key: "showCustomerNumber", label: "Mostrar número de cliente", description: "Añade el código interno junto a los datos fiscales." },
  { key: "showPaymentMethod", label: "Mostrar forma de pago", description: "Imprime la forma de pago y la cuenta seleccionada." },
  { key: "showTaxBreakdown", label: "Mostrar desglose fiscal", description: "Imprime la tabla de bases, tipos y cuotas." },
];

export function PdfSettingsForm({ initialValues }: { initialValues: PdfDisplaySettings }) {
  const [values, setValues] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/company/pdf-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la configuración del PDF."));
      toast.success("Configuración de PDF guardada. Se aplicará a los próximos PDFs que generes.");
    } catch (error) {
      const message = errorMessage(error, "No se pudo guardar la configuración del PDF.");
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <form aria-label="Opciones de PDF" className="space-y-3" onSubmit={save}>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Información visible en los PDFs</legend>
          {options.map((option) => {
            const inputId = `pdf-setting-${option.key}`;
            return (
              <label
                className="flex cursor-pointer gap-3 border border-window-dark-shadow bg-window-panel p-3 shadow-[inset_1px_1px_0_var(--window-highlight)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus"
                htmlFor={inputId}
                key={option.key}
              >
                <input
                  aria-describedby={`${inputId}-description`}
                  checked={values[option.key]}
                  className="mt-0.5"
                  id={inputId}
                  type="checkbox"
                  onChange={(event) => setValues((current) => ({ ...current, [option.key]: event.target.checked }))}
                />
                <span>
                  <span className="block font-mono text-xs font-bold">{option.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground" id={`${inputId}-description`}>{option.description}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <FormErrorMessage>{formError}</FormErrorMessage>
        <FormActions>
          <SubmitButton pending={saving}>
            <Save aria-hidden="true" />
            Guardar configuración PDF
          </SubmitButton>
        </FormActions>
      </form>

      <div aria-label="Vista previa del PDF" className="border border-window-dark-shadow bg-card p-4 text-card-foreground shadow-[inset_1px_1px_0_var(--window-highlight)]" role="img">
        <div className="mb-4 flex items-start justify-between border-b border-window-shadow pb-3">
          <div>
            {values.showLogo ? <div className="mb-2 h-2 w-12 bg-primary" /> : null}
            <p className="font-mono text-sm font-bold">Empresa Demo S.L.</p>
            {values.showEmail ? <p className="text-[10px] text-muted-foreground">facturacion@empresa.es</p> : null}
            {values.showPhone ? <p className="text-[10px] text-muted-foreground">+34 910 000 000</p> : null}
            {values.showWebsite ? <p className="text-[10px] text-primary">empresa.es</p> : null}
          </div>
          <div className="text-right">
            <FilePdf className="ml-auto size-5 text-primary" aria-hidden="true" />
            <p className="mt-1 font-mono text-lg font-bold">Factura</p>
            <p className="font-mono text-[10px] font-bold text-primary">FA-2026/000063</p>
          </div>
        </div>
        <div className="space-y-2 text-[10px]">
          <div className="h-8 bg-muted" />
          <div className="grid grid-cols-2 gap-2"><div className="h-12 bg-muted/60" /><div className="h-12 border-l-2 border-primary bg-muted/60" /></div>
          <div className="h-14 bg-muted" />
          {values.showTaxBreakdown ? <div className="h-8 border-y border-window-shadow" /> : null}
          {values.showPaymentMethod ? <div className="h-10 border-l-2 border-primary bg-primary/10" /> : null}
        </div>
      </div>
    </div>
  );
}
