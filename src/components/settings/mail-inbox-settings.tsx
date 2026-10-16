"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDateTime } from "@/lib/format";
import type { MailInboxSettingsView } from "@/server/ocr/mail-inbox";

const PRESETS = [
  { label: "Gmail", host: "imap.gmail.com", port: 993, secure: true, hint: "Usa una contraseña de aplicación de tu cuenta de Google (requiere verificación en dos pasos)." },
  { label: "Outlook / Microsoft 365", host: "outlook.office365.com", port: 993, secure: true, hint: "Tu organización debe permitir el acceso IMAP con contraseña de aplicación." },
  { label: "IONOS", host: "imap.ionos.es", port: 993, secure: true, hint: "Usuario: la dirección completa del buzón." },
] as const;

type FormState = {
  enabled: boolean;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
  processedMailbox: string;
  allowedSenders: string;
};

/**
 * Buzón al que se reenvían las facturas recibidas: el ERP lo revisa cada pocos minutos y cada PDF o
 * imagen adjunta de un remitente permitido entra en la bandeja de gastos, ya leída con IA.
 */
export function MailInboxSettings({ initial, suggestedSender }: { initial: MailInboxSettingsView; suggestedSender?: string | null }) {
  const id = useId();
  const [view, setView] = useState(initial);
  const [form, setForm] = useState<FormState>({
    enabled: initial.configured ? initial.enabled : true,
    host: initial.host,
    port: String(initial.port),
    secure: initial.secure,
    username: initial.username,
    password: "",
    mailbox: initial.mailbox,
    processedMailbox: initial.processedMailbox,
    allowedSenders: initial.allowedSenders || suggestedSender || "",
  });
  const [hint, setHint] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "test" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const payload = () => ({ ...form, port: Number(form.port) });

  async function call(kind: "save" | "test" | "check") {
    setPending(kind);
    setError(null);
    try {
      const url = kind === "save" ? "/api/expenses/mail-inbox" : `/api/expenses/mail-inbox/${kind}`;
      const response = await fetch(url, {
        method: kind === "save" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: kind === "check" ? "{}" : JSON.stringify(payload()),
      });
      if (!response.ok) throw new Error(await readApiError(response, kind === "test" ? "No se pudo conectar con el buzón." : kind === "check" ? "No se pudo revisar el buzón." : "No se pudo guardar el buzón."));
      const result = await response.json();
      if (kind === "save") {
        setView(result as MailInboxSettingsView);
        set("password", "");
        toast.success(form.enabled ? "Buzón guardado: se revisará cada pocos minutos." : "Buzón guardado (desactivado).");
      } else if (kind === "test") {
        toast.success(`Conexión correcta: ${(result as { messages: number }).messages} correos en la carpeta.`);
      } else {
        const checked = result as { imported: number; ignoredSenders: number; messages: number };
        toast.success(checked.messages === 0
          ? "No hay correos nuevos."
          : `${checked.imported} documento${checked.imported === 1 ? "" : "s"} enviado${checked.imported === 1 ? "" : "s"} a la bandeja${checked.ignoredSenders ? ` · ${checked.ignoredSenders} correo${checked.ignoredSenders === 1 ? "" : "s"} de remitentes no permitidos ignorado${checked.ignoredSenders === 1 ? "" : "s"}` : ""}.`);
        const refreshed = await fetch("/api/expenses/mail-inbox", { cache: "no-store" });
        if (refreshed.ok) setView(await refreshed.json());
      }
    } catch (callError) {
      const message = errorMessage(callError, "No se pudo completar la acción.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  }

  return (
    <form
      className="space-y-4"
      data-testid="mail-inbox-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void call("save");
      }}
    >
      <p className="max-w-3xl text-sm text-muted-foreground">
        Crea un buzón solo para facturas (por ejemplo <span className="font-mono">facturas@tuempresa.es</span>) y reenvíale las que recibas.
        Cada PDF o imagen adjunta de un remitente permitido aparecerá en la bandeja de gastos, ya leída con IA, para que la revises y registres.
        Solo se procesan los correos que lleguen después de activarlo.
      </p>

      {view.configured ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="mail-inbox-status">
          <StatusBadge tone={!view.enabled ? "neutral" : view.lastError ? "danger" : "success"}>
            {!view.enabled ? "Desactivado" : view.lastError ? "Con error" : "Activo"}
          </StatusBadge>
          {view.lastCheckedAt ? <span className="text-muted-foreground">Última revisión: {formatDateTime(view.lastCheckedAt)}{view.lastImportedCount ? ` · ${view.lastImportedCount} documentos importados` : ""}</span> : <span className="text-muted-foreground">Aún no se ha revisado.</span>}
          {view.lastError ? <span className="basis-full text-danger-text" role="alert">{view.lastError}</span> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Proveedor de correo">
        <span className="font-mono text-xs font-bold">Rellenar para:</span>
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            onClick={() => {
              setForm((current) => ({ ...current, host: preset.host, port: String(preset.port), secure: preset.secure }));
              setHint(preset.hint);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {preset.label}
          </Button>
        ))}
      </div>
      {hint ? <p className="text-xs text-muted-foreground" role="note">{hint}</p> : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <AccessibleField id={`${id}-host`} label="Servidor IMAP" required>
          <Input autoComplete="off" onChange={(event) => set("host", event.target.value)} placeholder="imap.tuproveedor.com" value={form.host} />
        </AccessibleField>
        <AccessibleField id={`${id}-port`} label="Puerto" required>
          <Input inputMode="numeric" onChange={(event) => set("port", event.target.value.replace(/\D/g, ""))} value={form.port} />
        </AccessibleField>
      </div>
      <label className="flex items-center gap-2 text-sm" htmlFor={`${id}-secure`}>
        <input checked={form.secure} id={`${id}-secure`} onChange={(event) => set("secure", event.target.checked)} type="checkbox" />
        Conexión cifrada SSL/TLS (recomendado, puerto 993)
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <AccessibleField id={`${id}-username`} label="Usuario" required helperText="Normalmente, la dirección de correo completa.">
          <Input autoComplete="off" onChange={(event) => set("username", event.target.value)} placeholder="facturas@tuempresa.es" value={form.username} />
        </AccessibleField>
        <AccessibleField
          id={`${id}-password`}
          label="Contraseña"
          required={!view.hasPassword}
          helperText={view.hasPassword ? "Guardada y cifrada. Déjala vacía para conservarla." : "Se guarda cifrada y no se vuelve a mostrar."}
        >
          <Input autoComplete="new-password" onChange={(event) => set("password", event.target.value)} placeholder={view.hasPassword ? "••••••••" : ""} type="password" value={form.password} />
        </AccessibleField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AccessibleField id={`${id}-mailbox`} label="Carpeta a revisar">
          <Input autoComplete="off" onChange={(event) => set("mailbox", event.target.value)} value={form.mailbox} />
        </AccessibleField>
        <AccessibleField id={`${id}-processed`} label="Mover los procesados a" helperText="Opcional. Si está vacío, solo se marcan como leídos.">
          <Input autoComplete="off" onChange={(event) => set("processedMailbox", event.target.value)} placeholder="Procesadas" value={form.processedMailbox} />
        </AccessibleField>
      </div>
      <AccessibleField
        id={`${id}-senders`}
        label="Remitentes permitidos"
        required
        helperText="Direcciones o dominios (@proveedor.com), separados por comas. Los correos de otros remitentes se ignoran: así nadie más puede meter documentos en tu bandeja."
      >
        <Textarea onChange={(event) => set("allowedSenders", event.target.value)} placeholder="tu@correo.es, @proveedor.com" rows={2} value={form.allowedSenders} />
      </AccessibleField>
      <label className="flex items-center gap-2 text-sm font-medium" htmlFor={`${id}-enabled`}>
        <input checked={form.enabled} id={`${id}-enabled`} onChange={(event) => set("enabled", event.target.checked)} type="checkbox" />
        Revisar este buzón automáticamente
      </label>

      <FormErrorMessage>{error}</FormErrorMessage>
      <div className="flex flex-wrap justify-end gap-2">
        {view.configured && view.enabled ? (
          <SubmitButton onClick={() => void call("check")} pending={pending === "check"} pendingLabel="Revisando…" type="button" variant="outline">
            Comprobar ahora
          </SubmitButton>
        ) : null}
        <SubmitButton data-testid="mail-inbox-test" onClick={() => void call("test")} pending={pending === "test"} pendingLabel="Conectando…" type="button" variant="outline">
          Probar conexión
        </SubmitButton>
        <SubmitButton data-testid="mail-inbox-save" pending={pending === "save"} pendingLabel="Guardando…">
          Guardar buzón
        </SubmitButton>
      </div>
    </form>
  );
}
