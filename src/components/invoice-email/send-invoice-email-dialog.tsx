"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { reminderLevelLabels, type ReminderLevel } from "@/server/dunning/schedule";
import { EMAIL_TEMPLATE_VARIABLES, isValidEmail, parseEmailList } from "@/server/invoice-email/templates";

type DraftResponse = {
  to: string[];
  subject: string;
  body: string;
  copyToSelfDefault: boolean;
  smtpConfigured: boolean;
  userEmail: string;
  invoice: { id: string; number: string; customerName: string; hasCustomerEmail: boolean };
};

type SendInvoiceEmailDialogProps = {
  invoiceId: string;
  number: string;
  /** INVOICE = enviar la factura; REMINDER = recordatorio de cobro. */
  kind?: "INVOICE" | "REMINDER";
  /** Nivel propuesto del recordatorio (el siguiente de la escalada). */
  reminderLevel?: ReminderLevel;
  asMenuItem?: boolean;
  triggerSize?: "default" | "sm";
  triggerVariant?: "default" | "outline";
};

type FieldErrors = Partial<Record<"to" | "cc" | "subject" | "body", string>>;

/**
 * "Enviar por email" / "Recordar cobro": diálogo con destinatario del cliente, CC, asunto y mensaje
 * de la plantilla (editables), PDF adjunto y copia opcional para el usuario. Cada envío queda en
 * el historial de la factura.
 */
export function SendInvoiceEmailDialog({
  asMenuItem = false,
  invoiceId,
  kind = "INVOICE",
  number,
  reminderLevel = 1,
  triggerSize = "default",
  triggerVariant = "outline",
}: SendInvoiceEmailDialogProps) {
  const router = useRouter();
  const toId = useId();
  const ccId = useId();
  const subjectId = useId();
  const bodyId = useId();
  const levelId = useId();
  const selfId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [level, setLevel] = useState<ReminderLevel>(reminderLevel);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copyToSelf, setCopyToSelf] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const isReminder = kind === "REMINDER";
  const label = isReminder ? "Recordar cobro" : "Enviar por email";

  async function loadDraft(nextLevel: ReminderLevel) {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ invoiceId, kind, ...(isReminder ? { level: String(nextLevel) } : {}) });
      const response = await fetch(`/api/invoice-emails?${query.toString()}`);
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo preparar el email."));
      const data = (await response.json()) as DraftResponse;
      setDraft(data);
      setTo(data.to.join(", "));
      setSubject(data.subject);
      setBody(data.body);
      setCopyToSelf(data.copyToSelfDefault);
    } catch (loadError) {
      setError(errorMessage(loadError, "No se pudo preparar el email."));
    } finally {
      setLoading(false);
    }
  }

  function openDialog() {
    setFieldErrors({});
    setCc("");
    setLevel(reminderLevel);
    setOpen(true);
    void loadDraft(reminderLevel);
  }

  function changeLevel(value: string) {
    const next: ReminderLevel = value === "3" ? 3 : value === "2" ? 2 : 1;
    setLevel(next);
    void loadDraft(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const toList = parseEmailList(to);
    const ccList = parseEmailList(cc);
    const nextErrors: FieldErrors = {};
    if (toList.length === 0) nextErrors.to = "Escribe al menos un email (si hay varios, sepáralos con comas).";
    else if (toList.some((email) => !isValidEmail(email))) nextErrors.to = "Revisa las direcciones: alguna no es un email válido.";
    if (ccList.some((email) => !isValidEmail(email))) nextErrors.cc = "Revisa las direcciones en copia.";
    if (!subject.trim()) nextErrors.subject = "Escribe el asunto.";
    if (!body.trim()) nextErrors.body = "Escribe el mensaje.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSending(true);
    try {
      const response = await fetch(isReminder ? "/api/dunning/remind" : "/api/invoice-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ invoiceId, to: toList, cc: ccList, subject, body, copyToSelf, ...(isReminder ? { reminderLevel: level } : {}) }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo enviar el email."));
      setOpen(false);
      toast.success(isReminder ? `Recordatorio de ${number} enviado a ${toList.join(", ")}.` : `Factura ${number} enviada a ${toList.join(", ")}.`);
      router.refresh();
    } catch (sendError) {
      const message = errorMessage(sendError, "No se pudo enviar el email.");
      setError(message);
      toast.error(message);
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  const smtpMissing = draft !== null && !draft.smtpConfigured;

  return (
    <>
      {asMenuItem ? (
        <DropdownMenuItem data-testid={`invoice-${isReminder ? "remind" : "email"}-menu-${invoiceId}`} onClick={openDialog}>
          {label}…
        </DropdownMenuItem>
      ) : (
        <Button data-testid={`invoice-${isReminder ? "remind" : "email"}-button`} onClick={openDialog} size={triggerSize} type="button" variant={triggerVariant}>
          {label}
        </Button>
      )}
      <Dialog
        description={isReminder ? "Se envía con la factura adjunta en PDF. Puedes cambiar el texto antes de enviarlo." : "La factura se adjunta en PDF. Puedes cambiar el texto antes de enviarlo."}
        initialFocusId={toId}
        onClose={() => { if (!sending) setOpen(false); }}
        open={open}
        size="lg"
        title={`${label} · ${number}`}
      >
        {loading && !draft ? <p className="text-sm text-muted-foreground" role="status">Preparando el email…</p> : null}
        {smtpMissing ? (
          <InlineAlert className="mb-3" title="El correo no está configurado" tone="warning">
            Para enviar emails hay que configurar el servidor de correo (SMTP) en Configuración. Mientras tanto puedes{" "}
            <Link className="underline" href={`/api/invoices/${invoiceId}/pdf`} prefetch={false} target="_blank">descargar el PDF</Link> y enviarlo desde tu correo.
          </InlineAlert>
        ) : null}
        {draft && !draft.invoice.hasCustomerEmail ? (
          <InlineAlert className="mb-3" tone="info">
            {draft.invoice.customerName} no tiene email de facturación. Escríbelo aquí o añádelo en su ficha para la próxima vez.
          </InlineAlert>
        ) : null}
        <form className="space-y-3" noValidate onSubmit={handleSubmit}>
          {isReminder ? (
            <AccessibleField helperText="Cada recordatorio sube de tono: amable, firme y último aviso." id={levelId} label="Tipo de recordatorio">
              <Select disabled={loading || sending} value={String(level)} onChange={(event) => changeLevel(event.target.value)}>
                {([1, 2, 3] as const).map((value) => <option key={value} value={value}>{reminderLevelLabels[value]}</option>)}
              </Select>
            </AccessibleField>
          ) : null}
          <AccessibleField error={fieldErrors.to} helperText="Varios destinatarios separados por comas." id={toId} label="Para" required>
            <Input autoComplete="email" disabled={sending} type="text" value={to} onChange={(event) => setTo(event.target.value)} />
          </AccessibleField>
          <AccessibleField error={fieldErrors.cc} id={ccId} label="CC (opcional)">
            <Input disabled={sending} type="text" value={cc} onChange={(event) => setCc(event.target.value)} />
          </AccessibleField>
          <AccessibleField error={fieldErrors.subject} id={subjectId} label="Asunto" required>
            <Input disabled={sending} maxLength={250} value={subject} onChange={(event) => setSubject(event.target.value)} />
          </AccessibleField>
          <AccessibleField
            error={fieldErrors.body}
            helperText={`Puedes usar ${EMAIL_TEMPLATE_VARIABLES.map((variable) => variable.token).join(", ")}.`}
            id={bodyId}
            label="Mensaje"
            required
          >
            <Textarea disabled={sending} rows={9} value={body} onChange={(event) => setBody(event.target.value)} />
          </AccessibleField>
          <label className="flex items-center gap-2 text-sm" htmlFor={selfId}>
            <input checked={copyToSelf} disabled={sending} id={selfId} onChange={(event) => setCopyToSelf(event.target.checked)} type="checkbox" />
            Enviarme una copia{draft?.userEmail ? ` (${draft.userEmail})` : ""}
          </label>
          <p className="text-xs text-muted-foreground">Adjunto: PDF de la factura {number}.</p>
          <FormErrorMessage>{error}</FormErrorMessage>
          <DialogFooter>
            <Button disabled={sending} onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
            <SubmitButton disabled={loading || smtpMissing || !draft} pending={sending} pendingLabel="Enviando…">
              {isReminder ? "Enviar recordatorio" : "Enviar factura"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
