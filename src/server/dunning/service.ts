import { and, asc, eq, gt, gte, sql } from "drizzle-orm";

import { company, customer, dunningCustomerOptOut, invoice, invoiceEmailLog, invoiceEmailSetting } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit";
import {
  agingBucket,
  daysAgoLabel,
  nextReminderLevel,
  scheduledReminderLevel,
  type AgingBucket,
  type ReminderLevel,
} from "@/server/dunning/schedule";
import {
  reminderStatsByInvoice,
  requireMailTransport,
  sendInvoiceEmail,
  settingsFromRow,
  type BulkEmailResult,
  type EmailActor,
} from "@/server/invoice-email/service";
import type { MailTransport } from "@/server/invoice-email/transport";
import { dateInputInTimeZone, todayDateInput } from "@/server/invoices/due-dates";
import { creditedByInvoiceSubquery, invoiceIsIssuedSql, netOutstandingSql, paidByInvoiceSubquery } from "@/server/invoices/sql";
import { daysBetween } from "@/server/recurring/schedule";

/** Cobros pendientes, recordatorios manuales y automáticos, y exclusión de clientes. */

export type CollectionRow = {
  invoiceId: string;
  number: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  optedOut: boolean;
  issueDate: Date;
  dueDate: string | null;
  totalAmount: number;
  outstandingAmount: number;
  daysOverdue: number | null;
  bucket: AgingBucket;
  remindersSent: number;
  lastReminderAt: Date | null;
  lastReminderLabel: string | null;
  nextLevel: ReminderLevel;
};

/** Facturas emitidas con importe pendiente (neto de cobros y rectificativas), con su antigüedad. */
export async function listCollections(companyId: string, options: { timeZone?: string; now?: Date } = {}): Promise<CollectionRow[]> {
  const paid = paidByInvoiceSubquery(companyId);
  const credited = creditedByInvoiceSubquery(companyId);
  const outstanding = netOutstandingSql(paid, credited);
  const rows = await db
    .select({
      invoiceId: invoice.id,
      number: invoice.number,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: sql<string | null>`coalesce(nullif(trim(${customer.invoiceEmail}), ''), nullif(trim(${customer.email}), ''))`,
      optedOut: sql<boolean>`(${dunningCustomerOptOut.id} is not null)`,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      outstandingAmount: outstanding.mapWith(Number),
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(paid, eq(paid.invoiceId, invoice.id))
    .leftJoin(credited, eq(credited.invoiceId, invoice.id))
    .leftJoin(dunningCustomerOptOut, and(eq(dunningCustomerOptOut.companyId, companyId), eq(dunningCustomerOptOut.customerId, customer.id)))
    .where(and(eq(invoice.companyId, companyId), eq(invoice.invoiceType, "INVOICE"), invoiceIsIssuedSql, gt(outstanding, sql`0`)))
    .orderBy(asc(invoice.dueDate), asc(invoice.id))
    .limit(2000);
  const stats = await reminderStatsByInvoice(companyId, rows.map((row) => row.invoiceId));
  const now = options.now ?? new Date();
  const today = todayDateInput(options.timeZone, now);
  return rows.map((row) => {
    const dueDate = row.dueDate ? dateInputInTimeZone(row.dueDate, options.timeZone) : null;
    const daysOverdue = dueDate ? daysBetween(dueDate, today) : null;
    const stat = stats.get(row.invoiceId);
    const lastReminderAt = stat?.lastSentAt ?? null;
    return {
      invoiceId: row.invoiceId,
      number: row.number,
      customerId: row.customerId,
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      optedOut: Boolean(row.optedOut),
      issueDate: row.issueDate,
      dueDate,
      totalAmount: Number(row.totalAmount),
      outstandingAmount: Math.round(row.outstandingAmount * 100) / 100,
      daysOverdue,
      bucket: agingBucket(daysOverdue),
      remindersSent: stat?.count ?? 0,
      lastReminderAt,
      lastReminderLabel: lastReminderAt ? daysAgoLabel(daysBetween(dateInputInTimeZone(lastReminderAt, options.timeZone), today)) : null,
      nextLevel: nextReminderLevel(stat?.count ?? 0),
    };
  });
}

export type SendReminderInput = {
  invoiceId: string;
  reminderLevel?: ReminderLevel | null;
  to?: string[] | string | null;
  cc?: string[] | string | null;
  subject?: string | null;
  body?: string | null;
  copyToSelfEmail?: string | null;
};

/** Recordatorio individual (diálogo). Sin nivel se usa el siguiente de la escalada. */
export async function sendPaymentReminder(actor: EmailActor, input: SendReminderInput, options: { transport?: MailTransport | null } = {}) {
  const level = input.reminderLevel ?? nextReminderLevel((await reminderStatsByInvoice(actor.companyId, [input.invoiceId])).get(input.invoiceId)?.count ?? 0);
  return sendInvoiceEmail(actor, { ...input, kind: "REMINDER", reminderLevel: level }, options);
}

/**
 * Recordatorios en bloque (seleccionadas en el listado). Omite, explicando el motivo, los clientes
 * excluidos, las facturas no vencidas y las ya cobradas.
 */
export async function sendPaymentRemindersBulk(actor: EmailActor, invoiceIds: string[], options: { timeZone?: string; transport?: MailTransport | null } = {}) {
  const transport = requireMailTransport(options.transport);
  const collections = new Map((await listCollections(actor.companyId, { timeZone: options.timeZone })).map((row) => [row.invoiceId, row]));
  const results: BulkEmailResult[] = [];
  for (const invoiceId of [...new Set(invoiceIds)]) {
    const row = collections.get(invoiceId);
    if (!row) {
      results.push({ invoiceId, number: null, ok: false, message: "No tiene importe pendiente (o no está emitida)." });
      continue;
    }
    if (row.optedOut) {
      results.push({ invoiceId, number: row.number, ok: false, message: `${row.customerName} está excluido de los recordatorios.` });
      continue;
    }
    if (row.daysOverdue === null || row.daysOverdue <= 0) {
      results.push({ invoiceId, number: row.number, ok: false, message: "Aún no ha vencido." });
      continue;
    }
    try {
      const sent = await sendInvoiceEmail(actor, { invoiceId, kind: "REMINDER", reminderLevel: row.nextLevel }, { transport });
      results.push({ invoiceId, number: row.number, ok: sent.status === "SENT", message: sent.status === "SENT" ? `Recordatorio ${row.nextLevel} enviado a ${sent.to.join(", ")}.` : `No se pudo enviar: ${sent.error}` });
    } catch (error) {
      results.push({ invoiceId, number: row.number, ok: false, message: error instanceof HttpError ? error.message : "Error inesperado al enviar." });
      if (!(error instanceof HttpError)) logger.error({ err: error, invoiceId }, "dunning.bulk_failed");
    }
  }
  return results;
}

/** ¿El cliente está excluido de los recordatorios de cobro? (mismo dato que la lista de cobros). */
export async function isCustomerDunningOptedOut(companyId: string, customerId: string) {
  const [row] = await db
    .select({ id: dunningCustomerOptOut.id })
    .from(dunningCustomerOptOut)
    .where(and(eq(dunningCustomerOptOut.companyId, companyId), eq(dunningCustomerOptOut.customerId, customerId)))
    .limit(1);
  return Boolean(row);
}

export async function setCustomerDunningOptOut(actor: { tenantId: string; companyId: string; actorUserId: string }, customerId: string, optOut: boolean) {
  const [owned] = await db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.companyId, actor.companyId)))
    .limit(1);
  if (!owned) throw new HttpError(404, "Cliente no encontrado.");
  await db.transaction(async (tx) => {
    if (optOut) {
      await tx
        .insert(dunningCustomerOptOut)
        .values({ companyId: actor.companyId, customerId, createdByUserId: actor.actorUserId })
        .onConflictDoNothing({ target: [dunningCustomerOptOut.companyId, dunningCustomerOptOut.customerId] });
    } else {
      await tx.delete(dunningCustomerOptOut).where(and(eq(dunningCustomerOptOut.companyId, actor.companyId), eq(dunningCustomerOptOut.customerId, customerId)));
    }
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: optOut ? "dunningCustomerOptOut.create" : "dunningCustomerOptOut.delete",
      entityName: "customer",
      entityId: customerId,
      payload: { customerName: owned.name, optOut },
    }, tx);
  });
  return { customerId, optOut };
}

export type DunningRunSummary = { companies: number; sent: number; failed: number; skipped: number };

/**
 * Recordatorios automáticos (worker): empresas con el calendario activado, facturas vencidas con
 * pendiente, cliente no excluido y con email. Cada factura recibe como mucho un recordatorio por
 * ejecución; `scheduledReminderLevel` decide si toca hoy.
 */
export async function processScheduledDunning(options: { now?: Date; transport?: MailTransport | null } = {}): Promise<DunningRunSummary> {
  const summary: DunningRunSummary = { companies: 0, sent: 0, failed: 0, skipped: 0 };
  const settingsRows = await db
    .select({ settings: invoiceEmailSetting, tenantId: company.tenantId, timezone: company.timezone })
    .from(invoiceEmailSetting)
    .innerJoin(company, eq(company.id, invoiceEmailSetting.companyId))
    .where(eq(invoiceEmailSetting.dunningEnabled, true));
  if (settingsRows.length === 0) return summary;
  let resolvedTransport: MailTransport;
  try {
    resolvedTransport = requireMailTransport(options.transport);
  } catch {
    logger.warn("dunning.skipped_smtp_not_configured");
    return summary;
  }
  const now = options.now ?? new Date();
  for (const row of settingsRows) {
    summary.companies += 1;
    const schedule = settingsFromRow(row.settings).dunning;
    const timeZone = row.timezone || undefined;
    const today = todayDateInput(timeZone, now);
    const collections = await listCollections(row.settings.companyId, { timeZone, now });
    // Un intento (enviado o fallido) en las últimas 20 h basta: evita reintentar un fallo en cada ciclo.
    const recentAttempts = new Set(
      (await db
        .select({ invoiceId: invoiceEmailLog.invoiceId })
        .from(invoiceEmailLog)
        .where(and(
          eq(invoiceEmailLog.companyId, row.settings.companyId),
          eq(invoiceEmailLog.kind, "REMINDER"),
          gte(invoiceEmailLog.sentAt, new Date(now.getTime() - 20 * 60 * 60 * 1000)),
        ))).map((attempt) => attempt.invoiceId),
    );
    for (const item of collections) {
      if (recentAttempts.has(item.invoiceId)) continue;
      if (item.optedOut || !item.customerEmail || !item.dueDate) {
        summary.skipped += 1;
        continue;
      }
      const level = scheduledReminderLevel({
        schedule,
        dueDate: item.dueDate,
        today,
        remindersSent: item.remindersSent,
        lastReminderDate: item.lastReminderAt ? dateInputInTimeZone(item.lastReminderAt, timeZone) : null,
      });
      if (!level) continue;
      try {
        const sent = await sendInvoiceEmail(
          { tenantId: row.tenantId, companyId: row.settings.companyId, actorUserId: null, trigger: "AUTOMATIC" },
          { invoiceId: item.invoiceId, kind: "REMINDER", reminderLevel: level },
          { transport: resolvedTransport },
        );
        if (sent.status === "SENT") summary.sent += 1;
        else summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error({ err: error, invoiceId: item.invoiceId }, "dunning.scheduled_failed");
      }
    }
  }
  return summary;
}
