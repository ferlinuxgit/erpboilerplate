"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, FormActions, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import type { DunningSchedule } from "@/server/dunning/schedule";
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_VARIABLES,
  emailTemplateLabels,
  type EmailTemplate,
  type EmailTemplateKey,
} from "@/server/invoice-email/templates";

const KEYS: EmailTemplateKey[] = ["invoice", "reminder1", "reminder2", "reminder3"];

type EmailSettingsFormProps = {
  initial: {
    templates: Record<EmailTemplateKey, EmailTemplate>;
    copyToSelfDefault: boolean;
    dunning: DunningSchedule;
  };
  smtpConfigured: boolean;
  canEdit: boolean;
};

function parseWholeNumber(value: string) {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) ? parsed : null;
}

/** Plantillas de email (envío y 3 recordatorios) y calendario de recordatorios automáticos. */
export function EmailSettingsForm({ canEdit, initial, smtpConfigured }: EmailSettingsFormProps) {
  const router = useRouter();
  const idBase = useId();
  const [templates, setTemplates] = useState(initial.templates);
  const [copyToSelfDefault, setCopyToSelfDefault] = useState(initial.copyToSelfDefault);
  const [enabled, setEnabled] = useState(initial.dunning.enabled);
  const [firstDelay, setFirstDelay] = useState(String(initial.dunning.firstDelayDays));
  const [interval, setIntervalDays] = useState(String(initial.dunning.intervalDays));
  const [maxReminders, setMaxReminders] = useState(String(initial.dunning.maxReminders));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateTemplate = (key: EmailTemplateKey, patch: Partial<EmailTemplate>) =>
    setTemplates((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const nextErrors: Record<string, string> = {};
    const first = parseWholeNumber(firstDelay);
    const every = parseWholeNumber(interval);
    const max = parseWholeNumber(maxReminders);
    if (first === null || first < 0 || first > 365) nextErrors.firstDelay = "Entre 0 y 365 días.";
    if (every === null || every < 1 || every > 365) nextErrors.interval = "Entre 1 y 365 días.";
    if (max === null || max < 1 || max > 3) nextErrors.maxReminders = "Entre 1 y 3.";
    for (const key of KEYS) {
      if (!templates[key].subject.trim()) nextErrors[`${key}-subject`] = "Escribe el asunto.";
      if (!templates[key].body.trim()) nextErrors[`${key}-body`] = "Escribe el mensaje.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || first === null || every === null || max === null) return;

    setSaving(true);
    try {
      const response = await fetch("/api/invoice-emails/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          templates,
          copyToSelfDefault,
          dunning: { enabled, firstDelayDays: first, intervalDays: every, maxReminders: max },
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron guardar las plantillas."));
      toast.success(enabled ? "Guardado. Los recordatorios automáticos quedan activados." : "Plantillas guardadas.");
      router.refresh();
    } catch (saveError) {
      setFormError(errorMessage(saveError, "No se pudieron guardar las plantillas."));
    } finally {
      setSaving(false);
    }
  }

  const fieldId = (suffix: string) => `${idBase}-${suffix}`;

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      {!smtpConfigured ? (
        <InlineAlert title="El correo saliente no está configurado" tone="warning">
          Puedes preparar las plantillas, pero no se enviará nada hasta que el administrador configure el servidor SMTP (variables SMTP_HOST y SMTP_FROM_EMAIL).
        </InlineAlert>
      ) : null}

      <fieldset className="space-y-3 border border-window-dark-shadow p-3" disabled={!canEdit}>
        <legend className="px-1 font-mono text-xs font-bold">Recordatorios automáticos</legend>
        <label className="flex items-start gap-2 text-sm" htmlFor={fieldId("enabled")}>
          <input checked={enabled} className="mt-1" id={fieldId("enabled")} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
          <span>
            <span className="font-semibold">Enviar recordatorios de cobro automáticamente</span>
            <span className="block text-xs text-muted-foreground">
              Solo a facturas vencidas con importe pendiente, de clientes con email y no excluidos. Cada recordatorio sube de tono.
            </span>
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <AccessibleField error={errors.firstDelay} helperText="Días después del vencimiento." id={fieldId("first")} label="Primer recordatorio">
            <Input disabled={!enabled} inputMode="numeric" value={firstDelay} onChange={(event) => setFirstDelay(event.target.value)} />
          </AccessibleField>
          <AccessibleField error={errors.interval} helperText="Días entre recordatorios." id={fieldId("interval")} label="Repetir cada">
            <Input disabled={!enabled} inputMode="numeric" value={interval} onChange={(event) => setIntervalDays(event.target.value)} />
          </AccessibleField>
          <AccessibleField error={errors.maxReminders} helperText="Como máximo 3 (el último es el aviso final)." id={fieldId("max")} label="Número máximo">
            <Input disabled={!enabled} inputMode="numeric" value={maxReminders} onChange={(event) => setMaxReminders(event.target.value)} />
          </AccessibleField>
        </div>
        {enabled ? (
          <p className="text-xs text-muted-foreground" role="status">
            Ejemplo: una factura que vence el día 1 recibirá el primer recordatorio el día {1 + (parseWholeNumber(firstDelay) ?? 0)}
            {(parseWholeNumber(maxReminders) ?? 1) > 1 ? ` y los siguientes cada ${parseWholeNumber(interval) ?? 7} días` : ""}.
          </p>
        ) : null}
      </fieldset>

      <label className="flex items-center gap-2 text-sm" htmlFor={fieldId("self")}>
        <input checked={copyToSelfDefault} disabled={!canEdit} id={fieldId("self")} onChange={(event) => setCopyToSelfDefault(event.target.checked)} type="checkbox" />
        Marcar «Enviarme una copia» por defecto al enviar
      </label>

      <p className="text-xs text-muted-foreground">
        Variables disponibles: {EMAIL_TEMPLATE_VARIABLES.map((variable) => `${variable.token} (${variable.help})`).join(", ")}.
      </p>

      {KEYS.map((key) => (
        <fieldset className="space-y-3 border border-window-dark-shadow p-3" disabled={!canEdit} key={key}>
          <legend className="px-1 font-mono text-xs font-bold">{emailTemplateLabels[key]}</legend>
          <AccessibleField error={errors[`${key}-subject`]} id={fieldId(`${key}-subject`)} label="Asunto" required>
            <Input maxLength={250} value={templates[key].subject} onChange={(event) => updateTemplate(key, { subject: event.target.value })} />
          </AccessibleField>
          <AccessibleField error={errors[`${key}-body`]} id={fieldId(`${key}-body`)} label="Mensaje" required>
            <Textarea rows={8} value={templates[key].body} onChange={(event) => updateTemplate(key, { body: event.target.value })} />
          </AccessibleField>
          <Button onClick={() => updateTemplate(key, DEFAULT_EMAIL_TEMPLATES[key])} size="sm" type="button" variant="outline">
            Restaurar texto por defecto
          </Button>
        </fieldset>
      ))}

      <FormErrorMessage>{formError}</FormErrorMessage>
      {canEdit ? (
        <FormActions>
          <SubmitButton pending={saving}>Guardar plantillas</SubmitButton>
        </FormActions>
      ) : null}
    </form>
  );
}
