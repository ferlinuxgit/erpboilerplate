"use client";

import { FilePdf, FloppyDisk as Save } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/company/pdf-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? "No se pudo guardar la configuración del PDF.");
      }
      toast.success("Configuración de PDF guardada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la configuración del PDF.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label className="flex cursor-pointer gap-3 border border-window-dark-shadow bg-window-panel p-3 shadow-[inset_1px_1px_0_var(--window-highlight)]" key={option.key}>
            <input
              checked={values[option.key]}
              className="mt-0.5"
              type="checkbox"
              onChange={(event) => setValues((current) => ({ ...current, [option.key]: event.target.checked }))}
            />
            <span>
              <span className="block font-mono text-xs font-bold">{option.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
        <div className="flex items-center justify-end sm:col-span-2">
          <Button disabled={saving} type="button" onClick={save}>
            <Save aria-hidden="true" />
            {saving ? "Guardando" : "Guardar configuración PDF"}
          </Button>
        </div>
      </div>

      <div className="border border-window-dark-shadow bg-white p-4 text-slate-900 shadow-[inset_1px_1px_0_white]">
        <div className="mb-4 flex items-start justify-between border-b border-slate-200 pb-3">
          <div>
            {values.showLogo ? <div className="mb-2 h-2 w-12 bg-teal-700" /> : null}
            <p className="text-sm font-bold">Empresa Demo S.L.</p>
            {values.showEmail ? <p className="text-[10px] text-slate-500">facturacion@empresa.es</p> : null}
            {values.showPhone ? <p className="text-[10px] text-slate-500">+34 910 000 000</p> : null}
            {values.showWebsite ? <p className="text-[10px] text-teal-700">empresa.es</p> : null}
          </div>
          <div className="text-right">
            <FilePdf className="ml-auto size-5 text-teal-700" aria-hidden="true" />
            <p className="mt-1 text-lg font-bold">Factura</p>
            <p className="text-[10px] font-bold text-teal-700">FA-2026/000063</p>
          </div>
        </div>
        <div className="space-y-2 text-[10px]">
          <div className="h-8 bg-slate-100" />
          <div className="grid grid-cols-2 gap-2"><div className="h-12 bg-slate-50" /><div className="h-12 border-l-2 border-teal-700 bg-slate-50" /></div>
          <div className="h-14 bg-slate-100" />
          {values.showTaxBreakdown ? <div className="h-8 border-y border-slate-200" /> : null}
          {values.showPaymentMethod ? <div className="h-10 border-l-2 border-teal-700 bg-teal-50" /> : null}
        </div>
      </div>
    </div>
  );
}
