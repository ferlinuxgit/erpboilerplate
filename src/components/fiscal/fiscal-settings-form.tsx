"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

export type FiscalSettingsFormValues = {
  logoUrl: string;
  paymentTermsDays: number;
  fiscalRegime: "general" | "recargo_equivalencia" | "cash_accounting" | "exempt";
  taxPeriodicity: "monthly" | "quarterly";
  siiEnabled: boolean;
  verifactuMode: "pending" | "verifactu" | "non_verifactu";
  prorrataPct: number;
  defaultCustomerAccountCode: string;
  defaultSupplierAccountCode: string;
  defaultSalesAccountCode: string;
  defaultPurchaseAccountCode: string;
  defaultBankAccountCode: string;
};

type FiscalSettingsFormProps = {
  initialValues: FiscalSettingsFormValues;
};

export function FiscalSettingsForm({ initialValues }: FiscalSettingsFormProps) {
  const [values, setValues] = useState(initialValues);
  const [loading, setLoading] = useState(false);

  const setValue = <Key extends keyof FiscalSettingsFormValues>(key: Key, value: FiscalSettingsFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/company-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "No se pudo guardar la configuración fiscal.");
      }
      toast.success("Configuración fiscal guardada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-medium">Configuración fiscal automática</h2>
          <p className="text-sm text-muted-foreground">Define reglas base para cierres, prorrata, SII y VERI*FACTU.</p>
        </div>
        <Button disabled={loading} onClick={submit} type="button">
          {loading ? "Guardando" : "Guardar configuración"}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Régimen fiscal</span>
          <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={values.fiscalRegime} onChange={(event) => setValue("fiscalRegime", event.target.value as FiscalSettingsFormValues["fiscalRegime"])}>
            <option value="general">General</option>
            <option value="recargo_equivalencia">Recargo de equivalencia</option>
            <option value="cash_accounting">Criterio de caja</option>
            <option value="exempt">Exento</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Periodicidad</span>
          <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={values.taxPeriodicity} onChange={(event) => setValue("taxPeriodicity", event.target.value as FiscalSettingsFormValues["taxPeriodicity"])}>
            <option value="quarterly">Trimestral</option>
            <option value="monthly">Mensual</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Prorrata deducible</span>
          <Input min={0} max={100} step="0.001" type="number" value={values.prorrataPct} onChange={(event) => setValue("prorrataPct", Number(event.target.value))} />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">VERI*FACTU</span>
          <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={values.verifactuMode} onChange={(event) => setValue("verifactuMode", event.target.value as FiscalSettingsFormValues["verifactuMode"])}>
            <option value="pending">Pendiente</option>
            <option value="verifactu">VERI*FACTU</option>
            <option value="non_verifactu">NO VERI*FACTU</option>
          </select>
        </label>

        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <input checked={values.siiEnabled} onChange={(event) => setValue("siiEnabled", event.target.checked)} type="checkbox" />
          <span>Empresa obligada o adscrita a SII</span>
        </label>
      </div>
    </div>
  );
}
