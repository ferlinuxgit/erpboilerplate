"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { HelpTerm } from "@/components/help/help-term";
import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PercentInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";

export type FiscalSettingsFormValues = {
  logoUrl: string;
  paymentTermsDays: number;
  fiscalRegime: "general" | "recargo_equivalencia" | "cash_accounting" | "exempt";
  taxPeriodicity: "monthly" | "quarterly";
  siiEnabled: boolean;
  verifactuMode: "pending" | "verifactu" | "non_verifactu";
  prorrataPct: number;
  taxpayerType: "company" | "individual";
  defaultCustomerAccountCode: string;
  defaultSupplierAccountCode: string;
  defaultSalesAccountCode: string;
  defaultPurchaseAccountCode: string;
  defaultBankAccountCode: string;
};

type FiscalSettingsFormProps = {
  initialValues: FiscalSettingsFormValues;
};

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/** Perfil fiscal: tipo de contribuyente, régimen, periodicidad, prorrata y SII. */
export function FiscalSettingsForm({ initialValues }: FiscalSettingsFormProps) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = <Key extends keyof FiscalSettingsFormValues>(key: Key, value: FiscalSettingsFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!Number.isFinite(values.prorrataPct) || values.prorrataPct < 0 || values.prorrataPct > 100) {
      setError("La prorrata tiene que estar entre 0 y 100 %.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // El modo VERI*FACTU se guarda aparte (VerifactuSettingsForm).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { verifactuMode: _verifactuMode, ...payload } = values;
      const response = await fetch("/api/company-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readError(response, "No se pudo guardar la configuración fiscal."));
      toast.success("Configuración fiscal guardada.");
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Error inesperado.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="rounded-[2px] border p-3" onSubmit={submit}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-medium">Cómo tributa tu negocio</h2>
          <p className="text-sm text-muted-foreground">Con estos datos calculamos qué modelos tienes que presentar y cuándo.</p>
        </div>
        <Button disabled={loading} type="submit">
          {loading ? "Guardando…" : "Guardar configuración"}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AccessibleField
          id="fiscal-taxpayer-type"
          label="Tipo de contribuyente"
          helperText={values.taxpayerType === "individual"
            ? "Autónomo: tributas en el IRPF y cada trimestre presentas el modelo 130 (estimación directa)."
            : "Sociedad (S.L., S.A.…): tributas en el Impuesto sobre Sociedades; no presentas el 130."}
        >
          <Select value={values.taxpayerType} onChange={(event) => setValue("taxpayerType", event.target.value as FiscalSettingsFormValues["taxpayerType"])}>
            <option value="company">Sociedad</option>
            <option value="individual">Autónomo (persona física)</option>
          </Select>
        </AccessibleField>

        <AccessibleField id="fiscal-regime" label="Régimen de IVA" helperText="Si no sabes cuál es, casi seguro es el general.">
          <Select value={values.fiscalRegime} onChange={(event) => setValue("fiscalRegime", event.target.value as FiscalSettingsFormValues["fiscalRegime"])}>
            <option value="general">General</option>
            <option value="recargo_equivalencia">Recargo de equivalencia (comercio minorista)</option>
            <option value="cash_accounting">Criterio de caja</option>
            <option value="exempt">Exento de IVA</option>
          </Select>
        </AccessibleField>

        <AccessibleField id="fiscal-periodicity" label="Periodicidad del IVA" helperText="Mensual solo si facturas más de 6 millones al año o estás en el SII o en devolución mensual.">
          <Select value={values.taxPeriodicity} onChange={(event) => setValue("taxPeriodicity", event.target.value as FiscalSettingsFormValues["taxPeriodicity"])}>
            <option value="quarterly">Trimestral</option>
            <option value="monthly">Mensual</option>
          </Select>
        </AccessibleField>

        <AccessibleField id="fiscal-prorrata" label="Prorrata deducible (%)" helperText={<>100 % salvo que tengas actividades exentas de IVA (formación, sanidad…). <HelpTerm term="prorrata">¿Qué es la prorrata?</HelpTerm></>}>
          <PercentInput value={values.prorrataPct} onValueChange={(value) => setValue("prorrataPct", value ?? Number.NaN)} />
        </AccessibleField>

        <label className="flex items-center gap-2 self-end rounded-[2px] border px-3 py-2 text-sm" htmlFor="fiscal-sii">
          <input checked={values.siiEnabled} id="fiscal-sii" onChange={(event) => setValue("siiEnabled", event.target.checked)} type="checkbox" />
          <span>Empresa obligada o adscrita al SII</span>
        </label>
      </div>
      {error ? <InlineAlert className="mt-3" role="alert" tone="danger">{error}</InlineAlert> : null}
    </form>
  );
}

type VerifactuSettingsFormProps = {
  initialMode: "pending" | "verifactu" | "non_verifactu";
  initialSince: string;
  issuerTaxId: string | null;
  issuerTaxIdValid: boolean;
};

/**
 * Interruptor "Modo VERI*FACTU" con explicación en lenguaje llano. Exige NIF de empresa válido y,
 * una vez activado, no se puede volver a "sin registros" (solo cambiar entre VERI*FACTU y NO VERI*FACTU).
 */
export function VerifactuSettingsForm({ initialMode, initialSince, issuerTaxId, issuerTaxIdValid }: VerifactuSettingsFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [since, setSince] = useState(initialSince);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const enabled = mode === "verifactu";
  const locked = initialMode !== "pending";

  const activating = initialMode === "pending" && mode !== "pending";

  const save = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/verifactu/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ mode, since: since || null }),
      });
      if (!response.ok) throw new Error(await readError(response, "No se pudo guardar el modo VERI*FACTU."));
      setConfirmOpen(false);
      toast.success(mode === "verifactu" ? "Modo VERI*FACTU activado." : "Configuración de VERI*FACTU guardada.");
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Error inesperado.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Activar el registro de facturas es irreversible: se confirma siempre antes de guardar.
    if (activating) {
      setError(null);
      setConfirmOpen(true);
      return;
    }
    void save();
  };

  return (
    <form className="space-y-3 rounded-[2px] border p-3" onSubmit={submit}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-sm font-medium">Modo VERI*FACTU</h2>
          <p className="text-sm text-muted-foreground">
            La ley antifraude obliga a que el programa de facturación guarde cada factura con una &quot;huella&quot; encadenada que impide
            modificarla a escondidas. En modo VERI*FACTU, además, cada factura se envía automáticamente a Hacienda y lleva un código QR
            que tu cliente puede comprobar. Es la opción más sencilla: no tienes que custodiar nada más.
          </p>
        </div>
        <StatusBadge tone={enabled ? "success" : mode === "non_verifactu" ? "info" : "warning"}>
          {enabled ? "Activado" : mode === "non_verifactu" ? "NO VERI*FACTU" : "Sin activar"}
        </StatusBadge>
      </div>

      {!issuerTaxIdValid ? (
        <InlineAlert tone="warning" title="Falta el NIF de la empresa">
          Para activarlo necesitamos un NIF válido en Configuración › Empresa{issuerTaxId ? ` (ahora: ${issuerTaxId})` : ""}.
        </InlineAlert>
      ) : null}

      <label className="flex items-center gap-3 rounded-[2px] border px-3 py-2 text-sm" htmlFor="verifactu-switch">
        <input
          aria-describedby="verifactu-switch-help"
          checked={enabled}
          className="size-4"
          disabled={!issuerTaxIdValid && !enabled}
          id="verifactu-switch"
          onChange={(event) => setMode(event.target.checked ? "verifactu" : locked ? "non_verifactu" : "pending")}
          role="switch"
          type="checkbox"
        />
        <span>
          <span className="font-medium">Enviar mis facturas a la AEAT (VERI*FACTU)</span>
          <span className="block text-xs text-muted-foreground" id="verifactu-switch-help">
            Las facturas que emitas desde la fecha indicada se registrarán y llevarán el QR y la leyenda &quot;VERI*FACTU&quot;.
          </span>
        </span>
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <AccessibleField id="verifactu-since" label="Aplicar desde" helperText="Déjalo vacío para empezar con la próxima factura que emitas.">
          <Input type="date" value={since} onChange={(event) => setSince(event.target.value)} />
        </AccessibleField>
        <details className="rounded-[2px] border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Opción avanzada: NO VERI*FACTU</summary>
          <p className="mt-2 text-muted-foreground">
            Las facturas se registran y encadenan igual, pero no se envían a Hacienda. Obliga a firmar y custodiar los registros y a
            atender requerimientos de la AEAT. Solo recomendable si tu asesor te lo indica.
          </p>
          <label className="mt-2 flex items-center gap-2" htmlFor="verifactu-non">
            <input checked={mode === "non_verifactu"} disabled={!issuerTaxIdValid} id="verifactu-non" onChange={(event) => setMode(event.target.checked ? "non_verifactu" : locked ? "verifactu" : "pending")} type="checkbox" />
            <span>Usar modo NO VERI*FACTU</span>
          </label>
        </details>
      </div>

      {locked ? (
        <p className="text-xs text-muted-foreground">Una vez activado, el registro de facturas no se puede desactivar; solo puedes cambiar entre VERI*FACTU y NO VERI*FACTU.</p>
      ) : null}
      {error && !confirmOpen ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
      <div className="flex justify-end">
        <Button disabled={loading || (mode === initialMode && since === initialSince)} type="submit">
          {loading ? "Guardando…" : activating ? "Activar el registro de facturas…" : "Guardar modo VERI*FACTU"}
        </Button>
      </div>
      <DestructiveActionDialog
        confirmLabel={mode === "verifactu" ? "Sí, activar VERI*FACTU" : "Sí, activar NO VERI*FACTU"}
        description={`${mode === "verifactu"
          ? "Desde la fecha indicada, cada factura que emitas se registrará con una huella encadenada, se enviará automáticamente a la AEAT y llevará el código QR."
          : "Desde la fecha indicada, cada factura que emitas se registrará con una huella encadenada que tendrás que firmar y custodiar."} Esta decisión es irreversible: el registro de facturas no se puede desactivar después; solo podrás cambiar entre VERI*FACTU y NO VERI*FACTU.`}
        errorMessage={error}
        isSubmitting={loading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={save}
        open={confirmOpen}
        title="¿Activar el registro de facturas?"
      />
    </form>
  );
}
