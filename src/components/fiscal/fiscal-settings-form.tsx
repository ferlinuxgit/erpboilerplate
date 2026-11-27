"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { HelpTerm } from "@/components/help/help-term";
import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { IGIC_REGIMES, igicRegimeHelp, igicRegimeLabels, isIgicRegime } from "@/lib/country-packs/igic";
import { getCsrfHeader } from "@/lib/csrf-client";

export type FiscalSettingsFormValues = {
  logoUrl: string;
  paymentTermsDays: number;
  /** IVA: general, recargo de equivalencia, criterio de caja o exento. IGIC (Canarias): además comerciante minorista y REPEP. */
  fiscalRegime: "general" | "recargo_equivalencia" | "cash_accounting" | "exempt" | "comerciante_minorista" | "pequeno_empresario";
  taxPeriodicity: "monthly" | "quarterly";
  siiEnabled: boolean;
  verifactuMode: "pending" | "verifactu" | "non_verifactu";
  prorrataPct: number;
  taxpayerType: "company" | "individual";
  /** Cuotas de IVA a compensar que vienen de ejercicios anteriores, por ejercicio ("2026" → importe). */
  vatCompensationOpening: Record<string, number>;
  /** Límite de la factura simplificada (sin NIF del cliente), IVA incluido: 400 o 3.000 €. */
  simplifiedInvoiceLimit: number;
  defaultCustomerAccountCode: string;
  defaultSupplierAccountCode: string;
  defaultSalesAccountCode: string;
  defaultPurchaseAccountCode: string;
  defaultBankAccountCode: string;
};

type FiscalSettingsFormProps = {
  initialValues: FiscalSettingsFormValues;
  /**
   * Países sin cumplimiento completo: solo se pregunta la periodicidad (régimen, prorrata,
   * autónomo/sociedad y SII son conceptos del IVA español).
   */
  spanishRegimes?: boolean;
  /** Régimen de IVA, prorrata y SII: false en Canarias, Ceuta y Melilla (IGIC / IPSI). Por defecto, igual que `spanishRegimes`. */
  vatRegimes?: boolean;
  /** Canarias: régimen del IGIC (general, comerciante minorista, REPEP, criterio de caja). */
  igicRegimes?: boolean;
  /** Nombre local del impuesto ("IVA", "TVA"…). */
  taxLabel?: string;
};

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/** Perfil fiscal: tipo de contribuyente, régimen, periodicidad, prorrata y SII. */
export function FiscalSettingsForm({ initialValues, spanishRegimes = true, vatRegimes, igicRegimes = false, taxLabel = "IVA" }: FiscalSettingsFormProps) {
  const showVatRegimes = vatRegimes ?? spanishRegimes;
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saldo inicial del ejercicio en curso y del anterior (el que aún puede estar presentándose en enero).
  const [openingYears] = useState(() => { const year = new Date().getFullYear(); return [year - 1, year]; });

  const setValue = <Key extends keyof FiscalSettingsFormValues>(key: Key, value: FiscalSettingsFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!Number.isFinite(values.prorrataPct) || values.prorrataPct < 0 || values.prorrataPct > 100) {
      setError("La prorrata tiene que estar entre 0 y 100 %.");
      return;
    }
    if (openingYears.some((year) => { const amount = values.vatCompensationOpening[String(year)] ?? 0; return !Number.isFinite(amount) || amount < 0; })) {
      setError("El IVA a compensar de ejercicios anteriores tiene que ser un importe positivo (o cero).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Solo el perfil fiscal: el modo VERI*FACTU se guarda aparte (VerifactuSettingsForm).
      const { taxpayerType, fiscalRegime, taxPeriodicity, siiEnabled, prorrataPct, simplifiedInvoiceLimit } = values;
      // Solo los ejercicios que se enseñan en el formulario; el resto se conserva en el servidor.
      const vatCompensationOpening = Object.fromEntries(openingYears.map((year) => [String(year), values.vatCompensationOpening[String(year)] ?? 0]));
      const payload = { taxpayerType, fiscalRegime, taxPeriodicity, siiEnabled, prorrataPct, simplifiedInvoiceLimit, ...(showVatRegimes ? { vatCompensationOpening } : {}) };
      const response = await fetch("/api/fiscal-profile", {
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
    <form className="rounded-surface border p-3" onSubmit={submit}>
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
        {spanishRegimes ? (
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
        ) : null}

        {igicRegimes ? (
        <AccessibleField
          id="fiscal-igic-regime"
          label="Régimen del IGIC"
          helperText={igicRegimeHelp[isIgicRegime(values.fiscalRegime) ? values.fiscalRegime : "general"]}
        >
          <Select
            value={isIgicRegime(values.fiscalRegime) ? values.fiscalRegime : "general"}
            onChange={(event) => setValue("fiscalRegime", event.target.value as FiscalSettingsFormValues["fiscalRegime"])}
          >
            {IGIC_REGIMES.map((regime) => <option key={regime} value={regime}>{igicRegimeLabels[regime]}</option>)}
          </Select>
        </AccessibleField>
        ) : null}

        {showVatRegimes ? (
        <AccessibleField id="fiscal-regime" label="Régimen de IVA" helperText="Si no sabes cuál es, casi seguro es el general.">
          <Select value={values.fiscalRegime} onChange={(event) => setValue("fiscalRegime", event.target.value as FiscalSettingsFormValues["fiscalRegime"])}>
            <option value="general">General</option>
            <option value="recargo_equivalencia">Recargo de equivalencia (comercio minorista)</option>
            <option value="cash_accounting">Criterio de caja</option>
            <option value="exempt">Exento de IVA</option>
          </Select>
        </AccessibleField>
        ) : null}

        <AccessibleField
          id="fiscal-periodicity"
          label={`Periodicidad del ${taxLabel}`}
          helperText={showVatRegimes
            ? "Mensual solo si facturas más de 6 millones al año o estás en el SII o en devolución mensual."
            : "Cada cuánto declaras el impuesto en tu país: agrupa el resumen de impuestos por ese periodo."}
        >
          <Select value={values.taxPeriodicity} onChange={(event) => setValue("taxPeriodicity", event.target.value as FiscalSettingsFormValues["taxPeriodicity"])}>
            <option value="quarterly">Trimestral</option>
            <option value="monthly">Mensual</option>
          </Select>
        </AccessibleField>

        <AccessibleField id="fiscal-simplified-limit" label="Facturas sin NIF del cliente" helperText="Sin NIF del cliente la factura es simplificada y tiene un importe máximo (IVA incluido). Por encima hay que identificar al cliente. Cada caja del TPV tiene su propio límite.">
          <Select value={values.simplifiedInvoiceLimit >= 3000 ? "3000" : "400"} onChange={(event) => setValue("simplifiedInvoiceLimit", Number(event.target.value))}>
            <option value="400">Hasta 400 € (regla general)</option>
            <option value="3000">Hasta 3.000 € (comercio al por menor, hostelería, transporte de personas, peluquerías…)</option>
          </Select>
        </AccessibleField>

        {showVatRegimes ? (
        <>
        <AccessibleField id="fiscal-prorrata" label="Prorrata deducible (%)" helperText={<>100 % salvo que tengas actividades exentas de IVA (formación, sanidad…). <HelpTerm term="prorrata">¿Qué es la prorrata?</HelpTerm></>}>
          <PercentInput value={values.prorrataPct} onValueChange={(value) => setValue("prorrataPct", value ?? Number.NaN)} />
        </AccessibleField>

        <label className="flex items-center gap-2 self-end rounded-surface border px-3 py-2 text-sm" htmlFor="fiscal-sii">
          <input checked={values.siiEnabled} id="fiscal-sii" onChange={(event) => setValue("siiEnabled", event.target.checked)} type="checkbox" />
          <span>Empresa obligada o adscrita al SII</span>
        </label>

        {openingYears.map((year) => (
          <AccessibleField
            id={`fiscal-vat-opening-${year}`}
            key={year}
            label={`IVA a compensar al empezar ${year}`}
            helperText={`Saldo a tu favor que dejaste «a compensar» en el último 303 de ${year - 1} (su casilla 87 más lo generado en ese periodo). Se descuenta solo en los 303 de ${year}: casillas 110 y 78. Déjalo a 0 si no había o si pediste la devolución.`}
          >
            <MoneyInput
              value={values.vatCompensationOpening[String(year)] ?? 0}
              onValueChange={(value) => setValue("vatCompensationOpening", { ...values.vatCompensationOpening, [String(year)]: value ?? Number.NaN })}
            />
          </AccessibleField>
        ))}
        </>
        ) : null}
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
  /** El envío a la AEAT funciona para esta empresa (transporte activo y certificado disponible). */
  operational: boolean;
  notOperationalReason: string | null;
  /** Ya hay registros generados: la fecha de inicio no se puede cambiar. */
  hasRecords: boolean;
  /** El administrador del sistema ha activado el envío a la AEAT (falta, como mucho, el certificado). */
  transportEnabled: boolean;
  certificate: CompanyCertificateSummary | null;
  /** Hay un certificado del sistema (colaboración social o apoderamiento) para las empresas sin el suyo. */
  systemCertificate: boolean;
  /** Titular y caducidad del certificado del sistema (null si el despliegue no tiene). */
  systemCertificateInfo?: SystemCertificateSummary | null;
};

/**
 * Activación de VERI*FACTU con explicación en lenguaje llano. Exige NIF de empresa válido y que el
 * envío a la AEAT esté operativo. Una vez activado no se puede desactivar ni cambiar de modalidad.
 */
export function VerifactuSettingsForm({ initialMode, initialSince, issuerTaxId, issuerTaxIdValid, operational, notOperationalReason, hasRecords, transportEnabled, certificate, systemCertificate, systemCertificateInfo = null }: VerifactuSettingsFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [since, setSince] = useState(initialSince);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const enabled = mode === "verifactu";
  const active = initialMode === "verifactu";
  const legacy = initialMode === "non_verifactu";
  const activating = !active && enabled;
  const canActivate = issuerTaxIdValid && operational;

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
      toast.success(activating ? "VERI*FACTU activado." : "Configuración de VERI*FACTU guardada.");
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
    <div className="space-y-3">
      <form className="space-y-3 rounded-surface border p-3" onSubmit={submit}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl space-y-1">
            <h2 className="text-sm font-medium">VERI*FACTU</h2>
            <p className="text-sm text-muted-foreground">
              La ley antifraude obliga a que el programa de facturación guarde cada factura con una &quot;huella&quot; encadenada que impide
              modificarla a escondidas. Con VERI*FACTU, además, cada factura se envía automáticamente a Hacienda y lleva un código QR
              que tu cliente puede comprobar. No tienes que custodiar nada más.
            </p>
          </div>
          <StatusBadge tone={active ? "success" : legacy ? "info" : "warning"}>
            {active ? "Activado" : legacy ? "NO VERI*FACTU (heredado)" : "Sin activar"}
          </StatusBadge>
        </div>

        {!issuerTaxIdValid ? (
          <InlineAlert tone="warning" title="Falta el NIF de la empresa">
            Para activarlo necesitamos un NIF válido en Configuración › Empresa{issuerTaxId ? ` (ahora: ${issuerTaxId})` : ""}.
          </InlineAlert>
        ) : null}

        {!operational && !active ? (
          <InlineAlert tone="warning" title="El envío a la AEAT todavía no está operativo">
            {notOperationalReason} Hasta entonces no se puede activar: una factura no puede anunciarse como «VERI*FACTU» si no se envía a Hacienda.
            {transportEnabled ? " Sube el certificado electrónico de la empresa más abajo." : " Lo configura el administrador del sistema."}
          </InlineAlert>
        ) : null}

        {!operational && active ? (
          <InlineAlert tone="danger" title="Tus facturas no se están enviando a la AEAT">
            {notOperationalReason} Los registros se siguen generando y quedan pendientes; mientras tanto las facturas llevan el QR pero no la leyenda «VERI*FACTU».
          </InlineAlert>
        ) : null}

        {legacy ? (
          <InlineAlert tone="warning" title="La modalidad NO VERI*FACTU ya no está disponible">
            Este sistema solo funciona como VERI*FACTU. Tus facturas siguen registrándose y encadenándose, pero para cumplir la norma debes pasar a
            VERI*FACTU (envío automático a la AEAT) activando el interruptor.
          </InlineAlert>
        ) : null}

        <label className="flex items-center gap-3 rounded-surface border px-3 py-2 text-sm" htmlFor="verifactu-switch">
          <input
            aria-describedby="verifactu-switch-help"
            checked={enabled}
            className="size-4"
            disabled={active || !canActivate}
            id="verifactu-switch"
            onChange={(event) => setMode(event.target.checked ? "verifactu" : initialMode)}
            role="switch"
            type="checkbox"
          />
          <span>
            <span className="font-medium">Enviar mis facturas a la AEAT (VERI*FACTU)</span>
            <span className="block text-xs text-muted-foreground" id="verifactu-switch-help">
              Las facturas que emitas desde la fecha indicada se registrarán, se enviarán y llevarán el QR y la leyenda &quot;VERI*FACTU&quot;.
            </span>
          </span>
        </label>

        <AccessibleField
          id="verifactu-since"
          label="Aplicar desde"
          helperText={hasRecords ? "Ya hay registros generados: la fecha de inicio no se puede cambiar." : "Déjalo vacío para empezar con la próxima factura que emitas."}
        >
          <Input className="md:max-w-xs" disabled={hasRecords} type="date" value={since} onChange={(event) => setSince(event.target.value)} />
        </AccessibleField>

        {active ? (
          <p className="text-xs text-muted-foreground">Una vez activado, VERI*FACTU no se puede desactivar ni cambiar de modalidad.</p>
        ) : null}
        {error && !confirmOpen ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
        <div className="flex justify-end">
          <Button disabled={loading || (mode === initialMode && since === initialSince)} type="submit">
            {loading ? "Guardando…" : activating ? "Activar VERI*FACTU…" : "Guardar"}
          </Button>
        </div>
        <DestructiveActionDialog
          confirmLabel="Sí, activar VERI*FACTU"
          description="Desde la fecha indicada, cada factura que emitas se registrará con una huella encadenada, se enviará automáticamente a la AEAT y llevará el código QR. Esta decisión es irreversible: no se puede desactivar después."
          errorMessage={error}
          isSubmitting={loading}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={save}
          open={confirmOpen}
          title="¿Activar VERI*FACTU?"
        />
      </form>
      {transportEnabled || certificate ? <VerifactuCertificateForm certificate={certificate} systemCertificate={systemCertificate} systemCertificateInfo={systemCertificateInfo} /> : null}
    </div>
  );
}

type CertificateValiditySummary = { expired: boolean; expiringSoon: boolean; daysLeft: number | null };

export type CompanyCertificateSummary = {
  fileName: string | null;
  uploadedAt: string;
  /** Titular del X.509; null en certificados subidos antes de que se leyera (se completa al primer envío). */
  subject?: string | null;
  /** NIF que figuran en el titular. */
  nifs?: string[];
  validTo?: string | null;
  isSeal?: boolean;
} & Partial<CertificateValiditySummary>;

export type SystemCertificateSummary = { subject: string | null; validTo: string | null; readable: boolean } & CertificateValiditySummary;

const certificateDate = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });

/** Caducidad en una frase: «válido hasta el…», «caduca en 12 días» o «caducó el…». */
function CertificateExpiry({ validTo, expired, expiringSoon, daysLeft }: { validTo: string | null | undefined } & Partial<CertificateValiditySummary>) {
  if (!validTo) return <span className="text-muted-foreground">Caducidad desconocida</span>;
  if (expired) return <strong className="text-danger-text">Caducó el {certificateDate(validTo)}</strong>;
  if (expiringSoon) {
    return <strong className="text-warning-text">Caduca el {certificateDate(validTo)}{typeof daysLeft === "number" ? ` (${daysLeft <= 0 ? "hoy" : daysLeft === 1 ? "queda 1 día" : `quedan ${daysLeft} días`})` : ""}</strong>;
  }
  return <>Válido hasta el {certificateDate(validTo)}</>;
}

/** Certificado electrónico (.p12/.pfx) con el que la empresa remite sus registros a la AEAT. */
function VerifactuCertificateForm({ certificate, systemCertificate, systemCertificateInfo }: { certificate: CompanyCertificateSummary | null; systemCertificate: boolean; systemCertificateInfo: SystemCertificateSummary | null }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  // Sin marcar se deduce del titular del certificado; marcado, se fuerza el punto de acceso de sello.
  const [isSeal, setIsSeal] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const upload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file) {
      setError("Selecciona el fichero del certificado (.p12 o .pfx).");
      return;
    }
    setBusy("save");
    setError(null);
    setWarnings([]);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("passphrase", passphrase);
      if (isSeal) body.set("seal", "true");
      const response = await fetch("/api/verifactu/certificate", { method: "PUT", headers: { ...getCsrfHeader() }, body });
      if (!response.ok) throw new Error(await readError(response, "No se pudo guardar el certificado."));
      const saved = (await response.json().catch(() => null)) as { warnings?: string[] } | null;
      const savedWarnings = Array.isArray(saved?.warnings) ? saved.warnings.filter((warning): warning is string => typeof warning === "string") : [];
      setWarnings(savedWarnings);
      if (savedWarnings.length > 0) toast.warning("Certificado guardado, con avisos: revísalos.");
      else toast.success("Certificado guardado.");
      setFile(null);
      setPassphrase("");
      setIsSeal(false);
      form.reset();
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Error inesperado.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      const response = await fetch("/api/verifactu/certificate", { method: "DELETE", headers: { ...getCsrfHeader() } });
      if (!response.ok) throw new Error(await readError(response, "No se pudo quitar el certificado."));
      toast.success("Certificado quitado.");
      setConfirmDelete(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Error inesperado.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <form className="space-y-3 rounded-surface border p-3" onSubmit={upload}>
      <div className="max-w-2xl space-y-1">
        <h2 className="text-sm font-medium">Certificado electrónico</h2>
        <p className="text-sm text-muted-foreground">
          Las facturas se envían a la AEAT firmando la conexión con el certificado electrónico de tu empresa (el mismo con el que presentas
          impuestos). Se guarda cifrado y solo se usa para este envío.
          {systemCertificate ? " Si no subes ninguno, se remite con el certificado del proveedor del sistema, que debe estar apoderado por tu empresa ante la AEAT." : ""}
        </p>
      </div>
      {certificate ? (
        <div className="space-y-1 text-sm" data-testid="verifactu-certificate-details">
          <p>
            <StatusBadge tone={certificate.expired ? "danger" : certificate.expiringSoon ? "warning" : "success"}>
              {certificate.expired ? "Certificado caducado" : certificate.expiringSoon ? "Caduca pronto" : "Certificado instalado"}
            </StatusBadge>{" "}
            {certificate.isSeal ? <StatusBadge tone="info">Sello electrónico</StatusBadge> : null}{" "}
            <span className="text-muted-foreground">{certificate.fileName ?? "certificado"} · subido el {new Date(certificate.uploadedAt).toLocaleDateString("es-ES")}</span>
          </p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">Titular</dt>
            <dd className="[overflow-wrap:anywhere]">{certificate.subject ?? "No se ha podido leer (se completará en el primer envío)."}</dd>
            <dt className="text-muted-foreground">NIF</dt>
            <dd className="font-mono">{certificate.nifs && certificate.nifs.length > 0 ? certificate.nifs.join(" · ") : "—"}</dd>
            <dt className="text-muted-foreground">Caducidad</dt>
            <dd><CertificateExpiry daysLeft={certificate.daysLeft} expired={certificate.expired} expiringSoon={certificate.expiringSoon} validTo={certificate.validTo} /></dd>
          </dl>
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          <p><StatusBadge tone={systemCertificate ? (systemCertificateInfo?.expired ? "danger" : "info") : "warning"}>{systemCertificate ? "Se usa el certificado del sistema" : "Sin certificado"}</StatusBadge></p>
          {systemCertificate && systemCertificateInfo ? (
            <p className="text-muted-foreground" data-testid="verifactu-system-certificate">
              {systemCertificateInfo.readable
                ? <>Titular: {systemCertificateInfo.subject ?? "desconocido"} · <CertificateExpiry daysLeft={systemCertificateInfo.daysLeft} expired={systemCertificateInfo.expired} expiringSoon={systemCertificateInfo.expiringSoon} validTo={systemCertificateInfo.validTo} /></>
                : "No se ha podido abrir el certificado del sistema: avisa al administrador o sube el de tu empresa."}
            </p>
          ) : null}
        </div>
      )}
      {warnings.length > 0 ? (
        <InlineAlert role="status" title="Avisos del certificado que acabas de subir" tone="warning">
          <ul className="list-disc space-y-1 pl-4" data-testid="verifactu-certificate-warnings">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </InlineAlert>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <AccessibleField id="verifactu-certificate-file" label={certificate ? "Sustituir por otro fichero (.p12 o .pfx)" : "Fichero del certificado (.p12 o .pfx)"}>
          <Input accept=".p12,.pfx,application/x-pkcs12" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
        </AccessibleField>
        <AccessibleField id="verifactu-certificate-passphrase" label="Contraseña del certificado">
          <Input autoComplete="off" onChange={(event) => setPassphrase(event.target.value)} type="password" value={passphrase} />
        </AccessibleField>
        <label className="flex items-start gap-2 text-sm md:col-span-2" htmlFor="verifactu-certificate-seal">
          <input checked={isSeal} className="mt-0.5" data-testid="verifactu-certificate-seal" id="verifactu-certificate-seal" onChange={(event) => setIsSeal(event.target.checked)} type="checkbox" />
          <span>
            Es un certificado de sello electrónico
            <span className="block text-xs text-muted-foreground">Los de sello se envían por un acceso distinto de la AEAT. Si no lo marcas, lo deducimos del titular del certificado.</span>
          </span>
        </label>
      </div>
      {error && !confirmDelete ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {certificate ? (
          <Button disabled={busy !== null} onClick={() => { setError(null); setConfirmDelete(true); }} type="button" variant="outline">Quitar certificado</Button>
        ) : null}
        <Button disabled={busy !== null || !file} type="submit">{busy === "save" ? "Guardando…" : "Guardar certificado"}</Button>
      </div>
      <DestructiveActionDialog
        confirmLabel="Sí, quitar"
        description={systemCertificate
          ? "Los envíos a la AEAT pasarán a hacerse con el certificado del sistema."
          : "Sin certificado las facturas dejarán de enviarse a la AEAT y quedarán pendientes hasta que subas otro."}
        errorMessage={error}
        isSubmitting={busy === "delete"}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        open={confirmDelete}
        title="¿Quitar el certificado?"
      />
    </form>
  );
}

/** Canarias: activar el AIEM crea sus tipos (5, 10, 15 y 25 %) y el modelo 450. */
export function AiemSettingsForm({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/fiscal-profile/aiem", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error(await readError(response, "No se pudo guardar el AIEM."));
      setEnabled(next);
      toast.success(next ? "AIEM activado: ya puedes añadirlo a las líneas y preparar el 450." : "AIEM desactivado.");
      router.refresh();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Error inesperado.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-surface border p-3">
      <label className="flex items-start gap-2 text-sm" htmlFor="fiscal-aiem">
        <input checked={enabled} className="mt-1 size-4 accent-primary" disabled={loading} id="fiscal-aiem" onChange={(event) => void save(event.target.checked)} type="checkbox" />
        <span>
          <span className="block font-medium">Fabrico o entrego en Canarias mercancías sujetas al AIEM</span>
          <span className="text-xs text-muted-foreground">
            Crea los tipos del arbitrio (5, 10, 15 y 25 %) para añadirlos a las líneas de esas mercancías y activa el modelo 450 trimestral.
            Solo para productores de los bienes del anexo de la Ley 4/2014; las importaciones lo pagan en aduana.
          </span>
        </span>
      </label>
      {error ? <InlineAlert className="mt-3" role="alert" tone="danger">{error}</InlineAlert> : null}
    </div>
  );
}
