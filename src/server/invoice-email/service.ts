import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { company, customer, dunningCustomerOptOut, invoice, invoiceEmailLog, invoiceEmailSetting } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit";
import { isEmailDeliveryConfigured } from "@/server/email/send";
import { DEFAULT_DUNNING_SCHEDULE, type DunningSchedule } from "@/server/dunning/schedule";
import { dateInputInTimeZone, todayDateInput } from "@/server/invoices/due-dates";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { getInvoiceBalance } from "@/server/invoices/service";
import {
  DEFAULT_EMAIL_TEMPLATES,
  isValidEmail,
  parseEmailList,
  plainTextToHtml,
  renderEmailTemplate,
  singleLineSubject,
  templateKeyFor,
  type EmailTemplate,
  type EmailTemplateKey,
  type EmailTemplateValues,
  type InvoiceEmailKind,
} from "@/server/invoice-email/templates";
import { getMailTransport, SMTP_NOT_CONFIGURED_MESSAGE, type MailAttachment, type MailTransport } from "@/server/invoice-email/transport";
import { daysBetween, formatScheduleDate } from "@/server/recurring/schedule";

/**
 * Envío de facturas y recordatorios de cobro por email: plantillas por empresa, PDF adjunto,
 * registro de cada intento (`invoice_email_log`) y auditoría.
 */

export type EmailActor = {
  tenantId: string;
  companyId: string;
  /** null en envíos automáticos sin usuario (worker). */
  actorUserId: string | null;
  trigger: "MANUAL" | "AUTOMATIC";
};

export type InvoiceEmailSettings = {
  templates: Record<EmailTemplateKey, EmailTemplate>;
  customized: Record<EmailTemplateKey, boolean>;
  copyToSelfDefault: boolean;
  dunning: DunningSchedule;
};

const TEMPLATE_COLUMNS: Record<EmailTemplateKey, { subject: keyof typeof invoiceEmailSetting.$inferSelect; body: keyof typeof invoiceEmailSetting.$inferSelect }> = {
  invoice: { subject: "invoiceSubject", body: "invoiceBody" },
  reminder1: { subject: "reminder1Subject", body: "reminder1Body" },
  reminder2: { subject: "reminder2Subject", body: "reminder2Body" },
  reminder3: { subject: "reminder3Subject", body: "reminder3Body" },
};

const TEMPLATE_KEYS: EmailTemplateKey[] = ["invoice", "reminder1", "reminder2", "reminder3"];

export function settingsFromRow(row: typeof invoiceEmailSetting.$inferSelect | null | undefined): InvoiceEmailSettings {
  const templates = {} as Record<EmailTemplateKey, EmailTemplate>;
  const customized = {} as Record<EmailTemplateKey, boolean>;
  for (const key of TEMPLATE_KEYS) {
    const subject = row ? row[TEMPLATE_COLUMNS[key].subject] : null;
    const body = row ? row[TEMPLATE_COLUMNS[key].body] : null;
    templates[key] = {
      subject: typeof subject === "string" && subject.trim() ? subject : DEFAULT_EMAIL_TEMPLATES[key].subject,
      body: typeof body === "string" && body.trim() ? body : DEFAULT_EMAIL_TEMPLATES[key].body,
    };
    customized[key] = Boolean((typeof subject === "string" && subject.trim()) || (typeof body === "string" && body.trim()));
  }
  return {
    templates,
    customized,
    copyToSelfDefault: row?.copyToSelfDefault ?? false,
    dunning: row
      ? {
          enabled: row.dunningEnabled,
          firstDelayDays: row.dunningFirstDelayDays,
          intervalDays: row.dunningIntervalDays,
          maxReminders: row.dunningMaxReminders,
        }
      : DEFAULT_DUNNING_SCHEDULE,
  };
}

export async function getInvoiceEmailSettings(companyId: string, client: DbClient = db) {
  const [row] = await client.select().from(invoiceEmailSetting).where(eq(invoiceEmailSetting.companyId, companyId)).limit(1);
  return settingsFromRow(row);
}

export type SaveInvoiceEmailSettingsInput = {
  templates: Partial<Record<EmailTemplateKey, { subject: string; body: string }>>;
  copyToSelfDefault: boolean;
  dunning: DunningSchedule;
};

/** Guarda plantillas y calendario. Un texto igual al de por defecto se guarda como null (sigue las mejoras futuras). */
export async function saveInvoiceEmailSettings(actor: { tenantId: string; companyId: string; actorUserId: string }, input: SaveInvoiceEmailSettingsInput) {
  const columns: Partial<typeof invoiceEmailSetting.$inferInsert> = {};
  for (const key of TEMPLATE_KEYS) {
    const template = input.templates[key];
    if (!template) continue;
    const subject = singleLineSubject(template.subject);
    const body = template.body.trim();
    Object.assign(columns, {
      [TEMPLATE_COLUMNS[key].subject]: subject && subject !== DEFAULT_EMAIL_TEMPLATES[key].subject ? subject : null,
      [TEMPLATE_COLUMNS[key].body]: body && body !== DEFAULT_EMAIL_TEMPLATES[key].body ? body : null,
    });
  }
  const values = {
    ...columns,
    copyToSelfDefault: input.copyToSelfDefault,
    dunningEnabled: input.dunning.enabled,
    dunningFirstDelayDays: input.dunning.firstDelayDays,
    dunningIntervalDays: input.dunning.intervalDays,
    dunningMaxReminders: input.dunning.maxReminders,
    updatedByUserId: actor.actorUserId,
    updatedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(invoiceEmailSetting)
      .values({ companyId: actor.companyId, ...values })
      .onConflictDoUpdate({ target: invoiceEmailSetting.companyId, set: values })
      .returning();
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "invoiceEmailSetting.update",
      entityName: "invoiceEmailSetting",
      entityId: saved.id,
      payload: { copyToSelfDefault: input.copyToSelfDefault, dunning: input.dunning, templates: Object.keys(input.templates) },
    }, tx);
    return settingsFromRow(saved);
  });
}

export type InvoiceEmailContext = {
  invoiceId: string;
  number: string;
  invoiceType: string;
  lifecycle: "DRAFT" | "ISSUED" | "VOID";
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  companyName: string;
  companyEmail: string | null;
  outstandingCents: number;
  dueDate: string | null;
  daysOverdue: number | null;
  values: EmailTemplateValues;
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
}

/** Datos de la factura necesarios para el email (null si no existe en la empresa). */
export async function loadInvoiceEmailContext(companyId: string, invoiceId: string, now = new Date()): Promise<InvoiceEmailContext | null> {
  const [row] = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      invoiceType: invoice.invoiceType,
      totalAmount: invoice.totalAmount,
      dueDate: invoice.dueDate,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      customerInvoiceEmail: customer.invoiceEmail,
      companyName: company.name,
      companyEmail: company.email,
      timezone: company.timezone,
      currency: company.baseCurrencyCode,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .innerJoin(company, eq(company.id, invoice.companyId))
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const balance = await getInvoiceBalance(db, companyId, row.id, row.totalAmount);
  const timeZone = row.timezone || undefined;
  const dueDate = row.dueDate ? dateInputInTimeZone(row.dueDate, timeZone) : null;
  const today = todayDateInput(timeZone, now);
  const daysOverdue = dueDate ? daysBetween(dueDate, today) : null;
  const currency = row.currency || "EUR";
  return {
    invoiceId: row.id,
    number: row.number,
    invoiceType: row.invoiceType,
    lifecycle: invoiceLifecycle(row),
    customerId: row.customerId,
    customerName: row.customerName,
    customerEmail: row.customerInvoiceEmail?.trim() || row.customerEmail?.trim() || null,
    companyName: row.companyName,
    companyEmail: row.companyEmail?.trim() || null,
    outstandingCents: balance.outstandingCents,
    dueDate,
    daysOverdue,
    values: {
      numero: row.number,
      cliente: row.customerName,
      total: money(balance.totalCents, currency),
      pendiente: money(balance.outstandingCents, currency),
      vencimiento: dueDate ? formatScheduleDate(dueDate) : "sin vencimiento",
      dias_vencida: String(Math.max(daysOverdue ?? 0, 0)),
      empresa: row.companyName,
    },
  };
}

export type EmailDraft = {
  to: string[];
  subject: string;
  body: string;
  copyToSelfDefault: boolean;
  smtpConfigured: boolean;
};

/** Propuesta editable del diálogo: destinatario del cliente y plantilla de la empresa ya rellenada. */
export async function buildInvoiceEmailDraft(companyId: string, invoiceId: string, options: { kind: InvoiceEmailKind; reminderLevel?: number | null }): Promise<(EmailDraft & { context: InvoiceEmailContext }) | null> {
  const context = await loadInvoiceEmailContext(companyId, invoiceId);
  if (!context) return null;
  const settings = await getInvoiceEmailSettings(companyId);
  const template = settings.templates[templateKeyFor(options.kind, options.reminderLevel)];
  return {
    context,
    to: context.customerEmail ? [context.customerEmail] : [],
    subject: singleLineSubject(renderEmailTemplate(template.subject, context.values)),
    body: renderEmailTemplate(template.body, context.values),
    copyToSelfDefault: settings.copyToSelfDefault,
    smtpConfigured: isEmailDeliveryConfigured(),
  };
}

export type DeliverEmailInput = {
  actor: EmailActor;
  context: InvoiceEmailContext;
  kind: InvoiceEmailKind;
  reminderLevel: number | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

export type DeliverEmailDeps = {
  transport: MailTransport;
  renderPdf: (companyId: string, invoiceId: string) => Promise<MailAttachment | null>;
  writeLog: (entry: typeof invoiceEmailLog.$inferInsert) => Promise<{ id: string }>;
  audit: typeof recordAudit;
};

export type DeliverEmailResult = { logId: string; status: "SENT" | "FAILED"; messageId: string | null; error: string | null };

/**
 * Envía un email ya validado con el PDF adjunto y registra el resultado (enviado o fallido).
 * No lanza por fallos del servidor SMTP: el fallo queda en el historial de la factura.
 */
export async function deliverInvoiceEmail(input: DeliverEmailInput, deps: DeliverEmailDeps): Promise<DeliverEmailResult> {
  const { actor, context } = input;
  const subject = singleLineSubject(renderEmailTemplate(input.subject, context.values));
  const bodyText = renderEmailTemplate(input.body, context.values);
  let messageId: string | null = null;
  let error: string | null = null;
  try {
    const pdf = await deps.renderPdf(actor.companyId, context.invoiceId);
    if (!pdf) throw new Error("No se pudo generar el PDF de la factura.");
    const result = await deps.transport.send({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: context.companyEmail,
      subject,
      text: bodyText,
      html: plainTextToHtml(bodyText),
      attachments: [pdf],
    });
    messageId = result.messageId;
  } catch (sendError) {
    error = (sendError instanceof Error ? sendError.message : String(sendError)).slice(0, 500) || "Error desconocido del servidor de correo.";
    logger.warn({ err: sendError, invoiceId: context.invoiceId, companyId: actor.companyId }, "invoice.email.failed");
  }
  const status = error ? "FAILED" : "SENT";
  const log = await deps.writeLog({
    companyId: actor.companyId,
    invoiceId: context.invoiceId,
    kind: input.kind,
    reminderLevel: input.kind === "REMINDER" ? input.reminderLevel : null,
    toEmails: input.to.join(", "),
    ccEmails: input.cc.length > 0 ? input.cc.join(", ") : null,
    subject,
    status,
    messageId,
    error,
    trigger: actor.trigger,
    userId: actor.actorUserId,
  });
  await deps.audit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId ?? undefined,
    action: input.kind === "REMINDER" ? "invoice.remind" : "invoice.email",
    entityName: "invoice",
    entityId: context.invoiceId,
    payload: { logId: log.id, status, to: input.to, cc: input.cc, reminderLevel: input.reminderLevel, trigger: actor.trigger, error },
  });
  return { logId: log.id, status, messageId, error };
}

async function renderInvoicePdfAttachment(companyId: string, invoiceId: string): Promise<MailAttachment | null> {
  // Import diferido: el renderizador PDF es pesado y solo hace falta al enviar.
  const [{ getInvoicePdfData }, { renderInvoicePdf }] = await Promise.all([import("@/server/pdf/invoice-pdf"), import("@/server/pdf/render")]);
  const data = await getInvoicePdfData(companyId, invoiceId);
  if (!data) return null;
  const content = await renderInvoicePdf(data.input);
  return { filename: data.filename, content: Buffer.from(content), contentType: "application/pdf" };
}

export function defaultDeliverDeps(transport: MailTransport): DeliverEmailDeps {
  return {
    transport,
    renderPdf: renderInvoicePdfAttachment,
    writeLog: async (entry) => {
      const [created] = await db.insert(invoiceEmailLog).values(entry).returning({ id: invoiceEmailLog.id });
      return created;
    },
    audit: recordAudit,
  };
}

export function requireMailTransport(transport?: MailTransport | null) {
  const resolved = transport === undefined ? getMailTransport() : transport;
  if (!resolved) throw new HttpError(409, SMTP_NOT_CONFIGURED_MESSAGE);
  return resolved;
}

function validateRecipients(to: string[], cc: string[]) {
  if (to.length === 0) throw new HttpError(400, "Indica al menos un destinatario. El cliente no tiene email de facturación: añádelo en su ficha o escríbelo aquí.");
  const invalid = [...to, ...cc].filter((email) => !isValidEmail(email));
  if (invalid.length > 0) throw new HttpError(400, `Revisa ${invalid.length === 1 ? "esta dirección" : "estas direcciones"}: ${invalid.join(", ")}.`);
  if (to.length + cc.length > 20) throw new HttpError(400, "Como máximo 20 destinatarios por envío.");
}

export type SendInvoiceEmailInput = {
  invoiceId: string;
  kind: InvoiceEmailKind;
  reminderLevel?: number | null;
  to?: string[] | string | null;
  cc?: string[] | string | null;
  subject?: string | null;
  body?: string | null;
  /** Email del usuario para enviarle copia oculta. */
  copyToSelfEmail?: string | null;
};

/** Envío individual desde la aplicación (diálogo) o desde el worker. */
export async function sendInvoiceEmail(actor: EmailActor, input: SendInvoiceEmailInput, options: { transport?: MailTransport | null; deps?: Partial<DeliverEmailDeps> } = {}) {
  const transport = requireMailTransport(options.transport);
  const context = await loadInvoiceEmailContext(actor.companyId, input.invoiceId);
  if (!context) throw new HttpError(404, "Factura no encontrada.");
  if (context.lifecycle !== "ISSUED") throw new HttpError(409, "Solo se pueden enviar facturas emitidas. Emite el borrador antes de enviarlo.");
  if (input.kind === "REMINDER") {
    if (context.invoiceType !== "INVOICE") throw new HttpError(409, "Las rectificativas no se reclaman.");
    if (context.outstandingCents <= 0) throw new HttpError(409, `La factura ${context.number} ya está cobrada: no hay nada que reclamar.`);
  }
  const settings = await getInvoiceEmailSettings(actor.companyId);
  const template = settings.templates[templateKeyFor(input.kind, input.reminderLevel)];
  const to = input.to === undefined || input.to === null ? (context.customerEmail ? [context.customerEmail] : []) : parseEmailList(input.to);
  const cc = parseEmailList(input.cc);
  validateRecipients(to, cc);
  const bcc = input.copyToSelfEmail && isValidEmail(input.copyToSelfEmail) ? [input.copyToSelfEmail] : [];
  const subject = input.subject?.trim() || template.subject;
  const body = input.body?.trim() || template.body;
  if (body.length > 20_000) throw new HttpError(400, "El mensaje es demasiado largo (máximo 20.000 caracteres).");
  const result = await deliverInvoiceEmail(
    { actor, context, kind: input.kind, reminderLevel: input.kind === "REMINDER" ? (input.reminderLevel ?? 1) : null, to, cc, bcc, subject, body },
    { ...defaultDeliverDeps(transport), ...options.deps },
  );
  return { ...result, number: context.number, to };
}

export type BulkEmailResult = { invoiceId: string; number: string | null; ok: boolean; message: string };

/** Envío en bloque con la plantilla de la empresa y el email de cada cliente. */
export async function sendInvoiceEmailsBulk(actor: EmailActor & { actorEmail?: string | null }, invoiceIds: string[], options: { copyToSelf?: boolean; transport?: MailTransport | null } = {}) {
  const transport = requireMailTransport(options.transport);
  const results: BulkEmailResult[] = [];
  for (const invoiceId of [...new Set(invoiceIds)]) {
    try {
      const sent = await sendInvoiceEmail(actor, { invoiceId, kind: "INVOICE", copyToSelfEmail: options.copyToSelf ? actor.actorEmail : null }, { transport });
      results.push({ invoiceId, number: sent.number, ok: sent.status === "SENT", message: sent.status === "SENT" ? `Enviada a ${sent.to.join(", ")}.` : `No se pudo enviar: ${sent.error}` });
    } catch (error) {
      results.push({ invoiceId, number: null, ok: false, message: error instanceof HttpError ? error.message : "Error inesperado al enviar." });
      if (!(error instanceof HttpError)) logger.error({ err: error, invoiceId }, "invoice.email.bulk_failed");
    }
  }
  return results;
}

export type InvoiceEmailLogEntry = {
  id: string;
  kind: InvoiceEmailKind;
  reminderLevel: number | null;
  toEmails: string;
  ccEmails: string | null;
  subject: string;
  status: "SENT" | "FAILED";
  error: string | null;
  trigger: "MANUAL" | "AUTOMATIC";
  sentAt: Date;
};

export async function listInvoiceEmailLog(companyId: string, invoiceId: string): Promise<InvoiceEmailLogEntry[]> {
  const rows = await db
    .select({
      id: invoiceEmailLog.id,
      kind: invoiceEmailLog.kind,
      reminderLevel: invoiceEmailLog.reminderLevel,
      toEmails: invoiceEmailLog.toEmails,
      ccEmails: invoiceEmailLog.ccEmails,
      subject: invoiceEmailLog.subject,
      status: invoiceEmailLog.status,
      error: invoiceEmailLog.error,
      trigger: invoiceEmailLog.trigger,
      sentAt: invoiceEmailLog.sentAt,
    })
    .from(invoiceEmailLog)
    .where(and(eq(invoiceEmailLog.companyId, companyId), eq(invoiceEmailLog.invoiceId, invoiceId)))
    .orderBy(desc(invoiceEmailLog.sentAt), desc(invoiceEmailLog.id))
    .limit(100);
  return rows.map((row) => ({
    ...row,
    kind: row.kind === "REMINDER" ? "REMINDER" : "INVOICE",
    status: row.status === "SENT" ? "SENT" : "FAILED",
    trigger: row.trigger === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL",
  }));
}

/** Recordatorios enviados con éxito por factura: número y fecha del último. */
export async function reminderStatsByInvoice(companyId: string, invoiceIds: string[], client: DbClient = db) {
  if (invoiceIds.length === 0) return new Map<string, { count: number; lastSentAt: Date | null }>();
  const rows = await client
    .select({
      invoiceId: invoiceEmailLog.invoiceId,
      count: sql<number>`count(*)::int`,
      lastSentAt: sql<Date | null>`max(${invoiceEmailLog.sentAt})`.mapWith((value: string | Date | null) => (value ? new Date(value) : null)),
    })
    .from(invoiceEmailLog)
    .where(and(
      eq(invoiceEmailLog.companyId, companyId),
      inArray(invoiceEmailLog.invoiceId, invoiceIds),
      eq(invoiceEmailLog.kind, "REMINDER"),
      eq(invoiceEmailLog.status, "SENT"),
    ))
    .groupBy(invoiceEmailLog.invoiceId);
  return new Map(rows.map((row) => [row.invoiceId, { count: Number(row.count), lastSentAt: row.lastSentAt }]));
}

export async function isCustomerOptedOut(companyId: string, customerId: string) {
  const [row] = await db
    .select({ id: dunningCustomerOptOut.id })
    .from(dunningCustomerOptOut)
    .where(and(eq(dunningCustomerOptOut.companyId, companyId), eq(dunningCustomerOptOut.customerId, customerId)))
    .limit(1);
  return Boolean(row);
}
