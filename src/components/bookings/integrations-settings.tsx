"use client";

import { CheckCircle, Copy, WarningCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { postJson } from "@/components/hospitality/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Integration = { enabled: boolean; config: Record<string, string>; secretsSet: string[]; lastTestAt: string | null; lastTestOk: boolean | null };
type Provider = "STRIPE" | "REDSYS" | "WHATSAPP";

type Field = { key: string; label: string; secret?: boolean; placeholder?: string; help?: string; options?: Array<[string, string]> };

const FIELDS: Record<Provider, Field[]> = {
  STRIPE: [
    { key: "secretKey", label: "Clave secreta", secret: true, placeholder: "sk_live_… o sk_test_…", help: "Stripe → Desarrolladores → Claves de API. Mejor una clave restringida con permiso de Checkout y Reembolsos." },
    { key: "webhookSecret", label: "Secreto del webhook", secret: true, placeholder: "whsec_…", help: "Crea un webhook con la URL de abajo y el evento checkout.session.completed. Sin él también funciona: se confirma al volver el cliente." },
  ],
  REDSYS: [
    { key: "merchantCode", label: "Código de comercio (FUC)", placeholder: "999008881" },
    { key: "terminal", label: "Terminal", placeholder: "1" },
    { key: "merchantKey", label: "Clave secreta (SHA-256)", secret: true, help: "En el panel de Redsys de tu banco (Administración → Comercio → Ver clave)." },
    { key: "merchantName", label: "Nombre que verá el cliente", placeholder: "Bar La Plaza" },
    { key: "environment", label: "Entorno", options: [["test", "Pruebas (sis-t)"], ["live", "Real"]] },
  ],
  WHATSAPP: [
    { key: "phoneNumberId", label: "Identificador del número", placeholder: "123456789012345", help: "Meta for Developers → tu app → WhatsApp → Configuración de la API." },
    { key: "accessToken", label: "Token de acceso permanente", secret: true, help: "Usa un token de usuario del sistema (no el temporal de 24 h)." },
    { key: "language", label: "Idioma de las plantillas", placeholder: "es" },
    { key: "countryCode", label: "Prefijo por defecto", placeholder: "34" },
    { key: "templateConfirmed", label: "Plantilla: reserva confirmada", placeholder: "reserva_confirmada" },
    { key: "templatePending", label: "Plantilla: reserva recibida (pendiente)", placeholder: "reserva_recibida" },
    { key: "templateReminder", label: "Plantilla: recordatorio", placeholder: "reserva_recordatorio" },
    { key: "templateCancelled", label: "Plantilla: reserva cancelada", placeholder: "reserva_cancelada" },
    { key: "templateWaitlist", label: "Plantilla: mesa libre (lista de espera)", placeholder: "lista_espera_mesa" },
  ],
};

const TITLES: Record<Provider, string> = { STRIPE: "Stripe", REDSYS: "Redsys (TPV virtual del banco)", WHATSAPP: "WhatsApp Business" };

/** Stripe, Redsys y WhatsApp de este restaurante: claves cifradas, prueba de conexión y URLs de aviso. */
export function IntegrationsSettings({ baseUrl, canManage, companyId, integrations }: { baseUrl: string; canManage: boolean; companyId: string; integrations: Record<Provider, Integration> }) {
  return (
    <div className="grid gap-4 xl:grid-cols-3" data-testid="integrations-settings">
      {(["STRIPE", "REDSYS", "WHATSAPP"] as const).map((provider) => <IntegrationCard baseUrl={baseUrl} canManage={canManage} companyId={companyId} initial={integrations[provider]} key={provider} provider={provider} />)}
    </div>
  );
}

function IntegrationCard({ baseUrl, canManage, companyId, initial, provider }: { baseUrl: string; canManage: boolean; companyId: string; initial: Integration; provider: Provider }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(provider === "REDSYS" ? { environment: "test", terminal: "1" } : provider === "WHATSAPP" ? { language: "es", countryCode: "34" } : {}), ...initial.config }));
  const [pending, setPending] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const disabled = !canManage || pending;
  const webhook = provider === "STRIPE" ? `${baseUrl}/api/public/payments/stripe/${companyId}` : provider === "REDSYS" ? `${baseUrl}/api/public/payments/redsys/${companyId}` : null;

  async function save() {
    setPending(true);
    try {
      const config: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const field of FIELDS[provider]) (field.secret ? secrets : config)[field.key] = values[field.key] ?? "";
      await postJson(`/api/pos/hospitality/integrations/${provider.toLowerCase()}`, { enabled, config, secrets }, "PUT");
      toast.success(`${TITLES[provider]} guardado.`);
      setValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !FIELDS[provider].find((field) => field.key === key)?.secret)));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setPending(false);
    }
  }

  async function runTest() {
    setPending(true);
    try {
      setTest(await postJson<{ ok: boolean; message: string }>(`/api/pos/hospitality/integrations/${provider.toLowerCase()}`, {}));
      router.refresh();
    } catch (error) {
      setTest({ ok: false, message: error instanceof Error ? error.message : "No se pudo probar." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={cn("space-y-3 border-2 p-3", enabled ? "border-success" : "border-window-shadow")} data-testid={`integration-${provider}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-sm font-bold">{TITLES[provider]}</h3>
        <label className="flex items-center gap-1.5 text-sm"><input checked={enabled} disabled={disabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /> Activo</label>
      </div>
      {FIELDS[provider].map((field) => (
        <label className="grid gap-1 text-sm font-medium" key={field.key}>
          {field.label}
          {field.options ? (
            <select className="h-10 border border-input bg-window-surface px-2 text-sm" disabled={disabled} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} value={values[field.key] ?? field.options[0][0]}>
              {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          ) : (
            <Input autoComplete="off" className="h-10" disabled={disabled} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} placeholder={field.secret && initial.secretsSet.includes(field.key) ? "•••••••• (guardada; escribe para cambiarla)" : field.placeholder} type={field.secret ? "password" : "text"} value={values[field.key] ?? ""} />
          )}
          {field.help ? <span className="text-xs font-normal text-muted-foreground">{field.help}</span> : null}
        </label>
      ))}
      {webhook ? (
        <div className="space-y-1 text-xs">
          <p className="font-medium">{provider === "STRIPE" ? "URL del webhook" : "URL de notificación (la manda el sistema solo)"}</p>
          <p className="flex items-center gap-1"><code className="min-w-0 flex-1 truncate border border-window-shadow bg-window-panel px-1 py-0.5">{webhook}</code><button aria-label="Copiar URL" className="grid size-8 place-items-center" onClick={() => void navigator.clipboard.writeText(webhook).then(() => toast.success("URL copiada."))} type="button"><Copy aria-hidden="true" className="size-4" /></button></p>
        </div>
      ) : (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-window-text">¿Cómo deben ser las plantillas?</summary>
          <p className="mt-1">Créalas en Meta (WhatsApp Manager → Plantillas, categoría «Utilidad») con estas variables en el cuerpo, en este orden: {"{{1}}"} nombre del cliente, {"{{2}}"} restaurante, {"{{3}}"} día y hora, {"{{4}}"} personas, {"{{5}}"} enlace. Ejemplo: «Hola {"{{1}}"}, tu reserva en {"{{2}}"} para el {"{{3}}"} ({"{{4}}"} personas) está confirmada. Gestiónala aquí: {"{{5}}"}».</p>
        </details>
      )}
      {test ? <p className={cn("flex items-start gap-1 text-sm font-semibold", test.ok ? "text-success-text" : "text-destructive")} role="status">{test.ok ? <CheckCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <WarningCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}{test.message}</p> : initial.lastTestAt ? <p className="text-xs text-muted-foreground">Última prueba: {initial.lastTestOk ? "correcta" : "fallida"} · {new Date(initial.lastTestAt).toLocaleString("es-ES")}</p> : null}
      {canManage ? (
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-11" data-testid={`integration-${provider}-save`} disabled={pending} onClick={() => void save()} type="button">Guardar</Button>
          <Button className="h-11" data-testid={`integration-${provider}-test`} disabled={pending} onClick={() => void runTest()} type="button" variant="outline">Probar</Button>
        </div>
      ) : null}
    </section>
  );
}
