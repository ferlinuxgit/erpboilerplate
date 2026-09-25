import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import {
  accountChart,
  company,
  customer,
  fiscalYear,
  invoice,
  partner,
  recurringRun,
  recurringTemplate,
  supplierInvoice,
  tax,
  tenant,
  type RecurringTemplateLine,
} from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit";
import { assertItemsBelongToCompany } from "@/server/inventory/ownership";
import { computeDueDate, todayDateInput } from "@/server/invoices/due-dates";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { resolveInvoicePaymentMethods } from "@/server/invoices/payment-methods";
import {
  createDraftInvoiceInTransaction,
  ensureCompanyDefaults,
  issueInvoiceInTransaction,
  loadStoredLines,
  resolveCustomerBillingDefaults,
  type InvoiceActor,
} from "@/server/invoices/service";
import { sendInvoiceEmail } from "@/server/invoice-email/service";
import type { MailTransport } from "@/server/invoice-email/transport";
import {
  intervalForFrequency,
  isRecurringFrequency,
  nextRunAfter,
  renderPeriodText,
  upcomingOccurrences,
  type RecurringFrequency,
  type RecurringSchedule,
} from "@/server/recurring/schedule";
import { isAutomaticMode, type RecurringIssueMode, type RecurringKind, type RecurringTemplateInput } from "@/server/recurring/schemas";
import { mapSalesLineTaxes } from "@/server/sales/service";
import { createExpenseInvoice } from "@/server/supplier-invoices/service";

/**
 * Plantillas recurrentes de facturas de venta y de gastos, y el motor que genera cada periodo.
 * Idempotencia: `recurring_run` es único por plantilla + fecha, y la plantilla se bloquea
 * (`FOR UPDATE SKIP LOCKED`) y se avanza en la misma transacción que crea el documento.
 */

export type RecurringActor = { tenantId: string; companyId: string; actorUserId: string };

type TemplateRow = typeof recurringTemplate.$inferSelect;

export function scheduleOf(row: Pick<TemplateRow, "startDate" | "dayOfMonth" | "intervalMonths" | "endDate" | "maxOccurrences">): RecurringSchedule {
  return {
    startDate: row.startDate,
    dayOfMonth: row.dayOfMonth,
    intervalMonths: row.intervalMonths,
    endDate: row.endDate,
    maxOccurrences: row.maxOccurrences,
  };
}

function normalizeTemplateInput(input: RecurringTemplateInput) {
  const frequency: RecurringFrequency = isRecurringFrequency(input.frequency) ? input.frequency : "MONTHLY";
  const lines: RecurringTemplateLine[] = input.lines.map((line) => ({
    itemId: line.itemId?.trim() || null,
    description: line.description.trim(),
    quantity: line.quantity,
    unitPrice: Math.round(line.unitPrice * 100) / 100,
    discountPct: line.discountPct ?? 0,
    taxRate: line.taxRate,
    retentionRate: line.retentionRate ?? 0,
    ...(input.kind === "EXPENSE"
      ? { expenseAccountId: line.expenseAccountId?.trim() || null, taxDeductiblePct: line.taxDeductiblePct ?? 100 }
      : {}),
  }));
  const startDay = Number(input.startDate.slice(8, 10));
  return {
    kind: input.kind,
    name: input.name.trim(),
    customerId: input.kind === "SALES_INVOICE" ? input.customerId?.trim() || null : null,
    supplierPartnerId: input.kind === "EXPENSE" ? input.supplierPartnerId?.trim() || null : null,
    frequency,
    intervalMonths: intervalForFrequency(frequency, input.everyMonths),
    startDate: input.startDate,
    endDate: input.endDate || null,
    dayOfMonth: input.lastDayOfMonth ? 31 : startDay,
    maxOccurrences: input.maxOccurrences ?? null,
    issueMode: input.issueMode,
    lines,
    notes: input.notes?.trim() || null,
  };
}

async function assertTemplateReferences(client: DbClient, companyId: string, values: ReturnType<typeof normalizeTemplateInput>) {
  if (values.kind === "SALES_INVOICE") {
    const [owned] = await client
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.id, values.customerId ?? ""), eq(customer.companyId, companyId), eq(customer.status, "ACTIVE")))
      .limit(1);
    if (!owned) throw new HttpError(404, "Cliente no encontrado (o inactivo) en la empresa activa.");
    await assertItemsBelongToCompany(client, companyId, values.lines.map((line) => line.itemId));
    return;
  }
  const [supplier] = await client
    .select({ id: partner.id })
    .from(partner)
    .where(and(eq(partner.id, values.supplierPartnerId ?? ""), eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"])))
    .limit(1);
  if (!supplier) throw new HttpError(404, "Proveedor no encontrado en la empresa activa.");
  const accountIds = [...new Set(values.lines.map((line) => line.expenseAccountId).filter((id): id is string => Boolean(id)))];
  const accounts = accountIds.length > 0
    ? await client.select({ id: accountChart.id }).from(accountChart).where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, accountIds)))
    : [];
  if (accounts.length !== accountIds.length) throw new HttpError(400, "Alguna cuenta de gasto no pertenece a la empresa.");
}

/** Tipo de una plantilla de la empresa (para elegir el permiso: facturas o gastos). */
export async function getRecurringTemplateKind(companyId: string, id: string): Promise<RecurringKind | null> {
  const [row] = await db
    .select({ kind: recurringTemplate.kind })
    .from(recurringTemplate)
    .where(and(eq(recurringTemplate.id, id), eq(recurringTemplate.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  return row.kind === "EXPENSE" ? "EXPENSE" : "SALES_INVOICE";
}

/** Tipo de la plantilla de una ejecución (confirmar/descartar gastos pendientes). */
export async function getRecurringRunKind(companyId: string, runId: string): Promise<RecurringKind | null> {
  const [row] = await db
    .select({ kind: recurringTemplate.kind })
    .from(recurringRun)
    .innerJoin(recurringTemplate, eq(recurringTemplate.id, recurringRun.templateId))
    .where(and(eq(recurringRun.id, runId), eq(recurringRun.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  return row.kind === "EXPENSE" ? "EXPENSE" : "SALES_INVOICE";
}

export function recurringPermissions(kind: RecurringKind) {
  return kind === "EXPENSE" ? { read: "expense.read", write: "expense.write" } as const : { read: "invoice.read", write: "invoice.create" } as const;
}

export async function createRecurringTemplate(actor: RecurringActor, input: RecurringTemplateInput) {
  const values = normalizeTemplateInput(input);
  await assertTemplateReferences(db, actor.companyId, values);
  const schedule = scheduleOf(values);
  const nextRunDate = nextRunAfter(schedule, null, 0);
  if (!nextRunDate) throw new HttpError(400, "Con esas fechas no habría ninguna emisión. Revisa la fecha final o el número de emisiones.");
  let sourceInvoiceId: string | null = null;
  if (input.sourceInvoiceId) {
    const [source] = await db
      .select({ id: invoice.id })
      .from(invoice)
      .where(and(eq(invoice.id, input.sourceInvoiceId), eq(invoice.companyId, actor.companyId)))
      .limit(1);
    sourceInvoiceId = source?.id ?? null;
  }
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(recurringTemplate)
      .values({
        ...values,
        companyId: actor.companyId,
        sourceInvoiceId,
        nextRunDate,
        status: "ACTIVE",
        createdByUserId: actor.actorUserId,
      })
      .returning({ id: recurringTemplate.id, name: recurringTemplate.name, nextRunDate: recurringTemplate.nextRunDate });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "recurringTemplate.create",
      entityName: "recurringTemplate",
      entityId: created.id,
      payload: { ...values, sourceInvoiceId, nextRunDate, automatic: isAutomaticMode(values.issueMode) },
    }, tx);
    return created;
  });
}

async function lockOwnedTemplate(tx: DbClient, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(recurringTemplate)
    .where(and(eq(recurringTemplate.id, id), eq(recurringTemplate.companyId, companyId)))
    .for("update")
    .limit(1);
  return row ?? null;
}

/** Última fecha generada (la de mayor periodo), para recalcular la siguiente tras una edición. */
async function lastGeneratedPeriod(client: DbClient, templateId: string) {
  const [last] = await client
    .select({ periodDate: recurringRun.periodDate })
    .from(recurringRun)
    .where(eq(recurringRun.templateId, templateId))
    .orderBy(desc(recurringRun.periodDate))
    .limit(1);
  return last?.periodDate ?? null;
}

/** Edita una plantilla. Los periodos ya generados no se repiten: la siguiente fecha es posterior al último. */
export async function updateRecurringTemplate(actor: RecurringActor, id: string, input: RecurringTemplateInput) {
  const values = normalizeTemplateInput(input);
  await assertTemplateReferences(db, actor.companyId, values);
  return db.transaction(async (tx) => {
    const current = await lockOwnedTemplate(tx, actor.companyId, id);
    if (!current) return null;
    if (current.kind !== values.kind) throw new HttpError(400, "No se puede cambiar el tipo de plantilla.");
    const lastPeriod = await lastGeneratedPeriod(tx, id);
    const nextRunDate = nextRunAfter(scheduleOf(values), lastPeriod, current.occurrencesGenerated);
    const status = nextRunDate ? (current.status === "FINISHED" ? "ACTIVE" : current.status) : "FINISHED";
    const [updated] = await tx
      .update(recurringTemplate)
      .set({ ...values, nextRunDate, status, lastError: null, updatedAt: new Date() })
      .where(and(eq(recurringTemplate.id, id), eq(recurringTemplate.companyId, actor.companyId)))
      .returning({ id: recurringTemplate.id, nextRunDate: recurringTemplate.nextRunDate, status: recurringTemplate.status });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "recurringTemplate.update",
      entityName: "recurringTemplate",
      entityId: id,
      payload: { ...values, nextRunDate, status },
    }, tx);
    return updated;
  });
}

/**
 * Pausa o reanuda. Al reanudar no se generan los periodos que pasaron en pausa: la siguiente
 * fecha pasa a ser la primera a partir de hoy.
 */
export async function setRecurringTemplateStatus(actor: RecurringActor, id: string, status: "ACTIVE" | "PAUSED", options: { timeZone?: string; now?: Date } = {}) {
  return db.transaction(async (tx) => {
    const current = await lockOwnedTemplate(tx, actor.companyId, id);
    if (!current) return null;
    if (current.status === "FINISHED") throw new HttpError(409, "La recurrencia ya terminó. Edita la fecha final o el número de emisiones para ampliarla.");
    let nextRunDate = current.nextRunDate;
    if (status === "ACTIVE" && current.status === "PAUSED" && nextRunDate) {
      const today = todayDateInput(options.timeZone, options.now);
      const schedule = scheduleOf(current);
      // Los periodos saltados no cuentan como emitidos (no consumen el máximo de emisiones).
      while (nextRunDate && nextRunDate < today) {
        nextRunDate = nextRunAfter(schedule, nextRunDate, current.occurrencesGenerated);
      }
    }
    const finalStatus = nextRunDate ? status : "FINISHED";
    const [updated] = await tx
      .update(recurringTemplate)
      .set({ status: finalStatus, nextRunDate, updatedAt: new Date() })
      .where(and(eq(recurringTemplate.id, id), eq(recurringTemplate.companyId, actor.companyId)))
      .returning({ id: recurringTemplate.id, status: recurringTemplate.status, nextRunDate: recurringTemplate.nextRunDate });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: status === "PAUSED" ? "recurringTemplate.pause" : "recurringTemplate.resume",
      entityName: "recurringTemplate",
      entityId: id,
      payload: { from: current.status, to: finalStatus, nextRunDate },
    }, tx);
    return updated;
  });
}

/** Borra la plantilla y su historial; las facturas y gastos ya generados no se tocan. */
export async function deleteRecurringTemplate(actor: RecurringActor, id: string) {
  return db.transaction(async (tx) => {
    const current = await lockOwnedTemplate(tx, actor.companyId, id);
    if (!current) return false;
    await tx.delete(recurringTemplate).where(and(eq(recurringTemplate.id, id), eq(recurringTemplate.companyId, actor.companyId)));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "recurringTemplate.delete",
      entityName: "recurringTemplate",
      entityId: id,
      payload: { name: current.name, kind: current.kind, occurrencesGenerated: current.occurrencesGenerated },
    }, tx);
    return true;
  });
}

/** Importe estimado de cada emisión (base + IVA − retención) para listas y confirmaciones. */
export function estimateTemplateTotal(lines: RecurringTemplateLine[]) {
  return calculateInvoiceTotals(lines.map((line) => ({ ...line, discountPct: line.discountPct ?? 0 }))).totalAmount;
}

export type RecurringTemplateListRow = {
  id: string;
  kind: RecurringKind;
  name: string;
  status: "ACTIVE" | "PAUSED" | "FINISHED";
  partyName: string;
  frequency: RecurringFrequency;
  intervalMonths: number;
  dayOfMonth: number;
  issueMode: RecurringIssueMode;
  nextRunDate: string | null;
  upcoming: string[];
  occurrencesGenerated: number;
  estimatedTotal: number;
  lastError: string | null;
  pendingReviewCount: number;
};

function asStatus(value: string): "ACTIVE" | "PAUSED" | "FINISHED" {
  return value === "PAUSED" || value === "FINISHED" ? value : "ACTIVE";
}

function asIssueMode(value: string): RecurringIssueMode {
  return value === "ISSUE" || value === "ISSUE_AND_EMAIL" || value === "POST" ? value : "DRAFT";
}

export async function listRecurringTemplates(companyId: string, kind: RecurringKind): Promise<RecurringTemplateListRow[]> {
  const rows = await db
    .select({
      template: recurringTemplate,
      customerName: customer.name,
      supplierName: partner.name,
      pendingReviewCount: sql<number>`(select count(*)::int from ${recurringRun} where ${recurringRun.templateId} = ${recurringTemplate.id} and ${recurringRun.status} = 'PENDING_REVIEW')`,
    })
    .from(recurringTemplate)
    .leftJoin(customer, eq(customer.id, recurringTemplate.customerId))
    .leftJoin(partner, eq(partner.id, recurringTemplate.supplierPartnerId))
    .where(and(eq(recurringTemplate.companyId, companyId), eq(recurringTemplate.kind, kind)))
    .orderBy(asc(recurringTemplate.status), asc(recurringTemplate.nextRunDate), asc(recurringTemplate.name), asc(recurringTemplate.id));
  return rows.map(({ customerName, pendingReviewCount, supplierName, template }) => ({
    id: template.id,
    kind,
    name: template.name,
    status: asStatus(template.status),
    partyName: customerName ?? supplierName ?? "—",
    frequency: isRecurringFrequency(template.frequency) ? template.frequency : "MONTHLY",
    intervalMonths: template.intervalMonths,
    dayOfMonth: template.dayOfMonth,
    issueMode: asIssueMode(template.issueMode),
    nextRunDate: template.status === "ACTIVE" ? template.nextRunDate : null,
    upcoming: template.status === "FINISHED" ? [] : upcomingOccurrences(scheduleOf(template), template.nextRunDate, template.occurrencesGenerated, 3),
    occurrencesGenerated: template.occurrencesGenerated,
    estimatedTotal: estimateTemplateTotal(template.lines),
    lastError: template.lastError,
    pendingReviewCount: Number(pendingReviewCount ?? 0),
  }));
}

export type RecurringRunRow = {
  id: string;
  periodDate: string;
  status: "GENERATED" | "PENDING_REVIEW" | "DISCARDED";
  message: string | null;
  createdAt: Date;
  document: { id: string; number: string; href: string; label: string } | null;
  estimatedTotal: number | null;
};

export async function getRecurringTemplateDetail(companyId: string, id: string) {
  const [row] = await db
    .select({ template: recurringTemplate, customerName: customer.name, supplierName: partner.name })
    .from(recurringTemplate)
    .leftJoin(customer, eq(customer.id, recurringTemplate.customerId))
    .leftJoin(partner, eq(partner.id, recurringTemplate.supplierPartnerId))
    .where(and(eq(recurringTemplate.id, id), eq(recurringTemplate.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const runs = await db
    .select({
      run: recurringRun,
      invoiceNumber: invoice.number,
      invoiceStatus: invoice.status,
      invoiceIssuedAt: invoice.issuedAt,
      supplierInvoiceNumber: supplierInvoice.number,
    })
    .from(recurringRun)
    .leftJoin(invoice, and(eq(invoice.id, recurringRun.invoiceId), eq(invoice.companyId, companyId)))
    .leftJoin(supplierInvoice, and(eq(supplierInvoice.id, recurringRun.supplierInvoiceId), eq(supplierInvoice.companyId, companyId)))
    .where(and(eq(recurringRun.companyId, companyId), eq(recurringRun.templateId, id)))
    .orderBy(desc(recurringRun.periodDate))
    .limit(120);
  const template = row.template;
  return {
    template: { ...template, status: asStatus(template.status), issueMode: asIssueMode(template.issueMode) },
    partyName: row.customerName ?? row.supplierName ?? "—",
    upcoming: template.status === "FINISHED" ? [] : upcomingOccurrences(scheduleOf(template), template.nextRunDate, template.occurrencesGenerated, 3),
    estimatedTotal: estimateTemplateTotal(template.lines),
    runs: runs.map(({ invoiceIssuedAt, invoiceNumber, invoiceStatus, run, supplierInvoiceNumber }): RecurringRunRow => {
      let document: RecurringRunRow["document"] = null;
      if (run.invoiceId && invoiceNumber) {
        const lifecycle = invoiceLifecycle({ status: invoiceStatus ?? "DRAFT", number: invoiceNumber, issuedAt: invoiceIssuedAt });
        document = {
          id: run.invoiceId,
          number: invoiceNumber,
          href: `/invoices/${run.invoiceId}`,
          label: lifecycle === "DRAFT" ? "Borrador" : lifecycle === "VOID" ? `${invoiceNumber} (anulada)` : invoiceNumber,
        };
      } else if (run.supplierInvoiceId && supplierInvoiceNumber) {
        document = { id: run.supplierInvoiceId, number: supplierInvoiceNumber, href: `/expenses/${run.supplierInvoiceId}`, label: supplierInvoiceNumber };
      }
      return {
        id: run.id,
        periodDate: run.periodDate,
        status: run.status === "PENDING_REVIEW" || run.status === "DISCARDED" ? run.status : "GENERATED",
        message: run.message,
        createdAt: run.createdAt,
        document,
        estimatedTotal: run.payload ? estimateTemplateTotal(run.payload.lines) : null,
      };
    }),
  };
}

/** Valores iniciales del formulario a partir de una factura existente ("Hacer recurrente"). */
export async function recurringPrefillFromInvoice(companyId: string, invoiceId: string) {
  const [source] = await db
    .select({ id: invoice.id, number: invoice.number, customerId: invoice.customerId, customerName: customer.name, invoiceType: invoice.invoiceType, notes: invoice.notes, issueDate: invoice.issueDate })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);
  if (!source || source.invoiceType !== "INVOICE") return null;
  const lines = await loadStoredLines(db, source.id);
  return {
    sourceInvoiceId: source.id,
    sourceNumber: source.number,
    customerId: source.customerId,
    name: `${source.customerName} · recurrente`,
    notes: source.notes ?? "",
    lines: lines.map((line) => {
      const taxes = line.taxes ?? null;
      const vat = taxes ? taxes.filter((item) => item.operation === "ADD" && (item.kind ?? "VAT") === "VAT").reduce((sum, item) => sum + item.rate, 0) : Number(line.taxRate ?? 0);
      const retention = taxes ? taxes.filter((item) => item.operation === "SUBTRACT").reduce((sum, item) => sum + item.rate, 0) : Number(line.retentionRate ?? 0);
      return {
        itemId: line.itemId ?? null,
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discountPct: Number(line.discountPct ?? 0),
        taxRate: vat,
        retentionRate: retention,
      };
    }),
  };
}

/** Clientes activos para el formulario (con aviso si no tienen email para el envío automático). */
export async function listRecurringCustomerOptions(companyId: string) {
  const rows = await db
    .select({ id: customer.id, name: customer.name, email: customer.email, invoiceEmail: customer.invoiceEmail })
    .from(customer)
    .where(and(eq(customer.companyId, companyId), eq(customer.status, "ACTIVE")))
    .orderBy(asc(customer.name), asc(customer.id))
    .limit(5000);
  return rows.map((row) => ({ id: row.id, name: row.name, hasEmail: Boolean(row.invoiceEmail?.trim() || row.email?.trim()) }));
}

// ─── Motor de generación ───────────────────────────────────────────────────────────────────

type CompanyContext = { tenantId: string; companyId: string; countryCode: string; timeZone: string | undefined; ownerId: string };

async function resolveFiscalYearId(client: DbClient, companyId: string, periodDate: string) {
  const at = new Date(`${periodDate}T12:00:00.000Z`);
  const [covering] = await client
    .select({ id: fiscalYear.id })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.companyId, companyId), lte(fiscalYear.startsAt, at), gte(fiscalYear.endsAt, at)))
    .limit(1);
  if (covering) return covering.id;
  const [latest] = await client.select({ id: fiscalYear.id }).from(fiscalYear).where(eq(fiscalYear.companyId, companyId)).orderBy(desc(fiscalYear.startsAt)).limit(1);
  if (!latest) throw new HttpError(409, "La empresa no tiene ningún ejercicio fiscal.");
  return latest.id;
}

function workerActor(template: TemplateRow, companyContext: CompanyContext, fiscalYearId: string): InvoiceActor {
  return {
    tenantId: companyContext.tenantId,
    companyId: companyContext.companyId,
    actorUserId: template.createdByUserId ?? companyContext.ownerId,
    countryCode: companyContext.countryCode,
    activeFiscalYearId: fiscalYearId,
  };
}

function renderLines(lines: RecurringTemplateLine[], periodDate: string): RecurringTemplateLine[] {
  return lines.map((line) => ({ ...line, description: renderPeriodText(line.description, periodDate) }));
}

function errorText(error: unknown) {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error && error.message) return error.message.slice(0, 300);
  return "Error inesperado.";
}

/** Avanza la plantilla tras generar `periodDate` (misma transacción que el documento). */
async function advanceTemplate(tx: DbClient, template: TemplateRow, periodDate: string, counted: boolean) {
  const generated = template.occurrencesGenerated + (counted ? 1 : 0);
  const nextRunDate = nextRunAfter(scheduleOf(template), periodDate, generated);
  await tx
    .update(recurringTemplate)
    .set({
      occurrencesGenerated: generated,
      nextRunDate,
      status: nextRunDate ? template.status : "FINISHED",
      lastRunAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(recurringTemplate.id, template.id));
}

/** Bloquea la plantilla solo si sigue activa y pendiente de ese periodo (otro worker pudo adelantarse). */
async function lockDueTemplate(tx: DbClient, templateId: string, periodDate: string) {
  const [row] = await tx
    .select()
    .from(recurringTemplate)
    .where(and(eq(recurringTemplate.id, templateId), eq(recurringTemplate.status, "ACTIVE"), eq(recurringTemplate.nextRunDate, periodDate)))
    .for("update", { skipLocked: true })
    .limit(1);
  return row ?? null;
}

export type GenerationOutcome = { templateId: string; periodDate: string; status: "GENERATED" | "PENDING_REVIEW" | "SKIPPED"; runId: string | null; message: string | null };

async function generateInvoicePeriod(template: TemplateRow, periodDate: string, companyContext: CompanyContext, options: { transport?: MailTransport | null }): Promise<GenerationOutcome> {
  const fiscalYearId = await resolveFiscalYearId(db, companyContext.companyId, periodDate);
  const actor = workerActor(template, companyContext, fiscalYearId);
  const wantsIssue = template.issueMode === "ISSUE" || template.issueMode === "ISSUE_AND_EMAIL";
  let issueError: string | null = null;
  if (wantsIssue) {
    try {
      await ensureCompanyDefaults(actor);
    } catch (error) {
      issueError = errorText(error);
    }
  }
  const result = await db.transaction(async (tx) => {
    const locked = await lockDueTemplate(tx, template.id, periodDate);
    if (!locked) return null;
    const [run] = await tx
      .insert(recurringRun)
      .values({ companyId: locked.companyId, templateId: locked.id, periodDate, status: "GENERATED" })
      .onConflictDoNothing({ target: [recurringRun.templateId, recurringRun.periodDate] })
      .returning({ id: recurringRun.id });
    if (!run) {
      await advanceTemplate(tx, locked, periodDate, false);
      return { runId: null, invoiceId: null, issued: false, message: null };
    }
    const customerId = locked.customerId ?? "";
    const billing = await resolveCustomerBillingDefaults(tx, locked.companyId, customerId);
    const paymentMethods = (await resolveInvoicePaymentMethods(locked.companyId, billing.paymentMethodIds)) ?? [];
    const companyTaxes = await tx
      .select({ id: tax.id, name: tax.name, rate: tax.rate, kind: tax.kind, operation: tax.operation, isDefault: tax.isDefault, isActive: tax.isActive })
      .from(tax)
      .where(and(eq(tax.companyId, locked.companyId), eq(tax.isActive, true)));
    const issueDate = new Date(`${periodDate}T00:00:00.000Z`);
    const lines = renderLines(locked.lines, periodDate).map((line) => ({
      itemId: line.itemId ?? null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct ?? 0,
      taxRate: line.taxRate,
      retentionRate: line.retentionRate,
      taxes: mapSalesLineTaxes(line, companyTaxes),
    }));
    const draft = await createDraftInvoiceInTransaction(tx, actor, {
      customerId,
      issueDate,
      dueDate: computeDueDate(issueDate, billing.termsDays),
      paymentMethods,
      lines,
      vatTreatment: null,
      notes: locked.notes ? renderPeriodText(locked.notes, periodDate) : null,
      auditPayload: { origin: "recurring", recurringTemplateId: locked.id, periodDate },
    });
    let issued = false;
    if (wantsIssue && !issueError) {
      try {
        // Punto de guardado: si la emisión falla (periodo cerrado, datos fiscales…) el borrador se conserva.
        await tx.transaction((savepoint) => issueInvoiceInTransaction(savepoint, actor, draft.id));
        issued = true;
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        issueError = error.message;
      }
    }
    const message = wantsIssue && !issued ? `No se pudo emitir automáticamente (${issueError ?? "motivo desconocido"}). La factura queda en borrador para revisarla.` : null;
    await tx.update(recurringRun).set({ invoiceId: draft.id, message, updatedAt: new Date() }).where(eq(recurringRun.id, run.id));
    await advanceTemplate(tx, locked, periodDate, true);
    return { runId: run.id, invoiceId: draft.id, issued, message };
  });
  if (!result) return { templateId: template.id, periodDate, status: "SKIPPED", runId: null, message: null };
  let message = result.message;
  if (result.issued && result.invoiceId && result.runId && template.issueMode === "ISSUE_AND_EMAIL") {
    let emailError: string | null = null;
    try {
      const sent = await sendInvoiceEmail(
        { tenantId: companyContext.tenantId, companyId: companyContext.companyId, actorUserId: null, trigger: "AUTOMATIC" },
        { invoiceId: result.invoiceId, kind: "INVOICE" },
        { transport: options.transport },
      );
      if (sent.status !== "SENT") emailError = sent.error;
    } catch (error) {
      emailError = errorText(error);
    }
    if (emailError) {
      message = `Emitida, pero no se pudo enviar por email: ${emailError}`;
      await db.update(recurringRun).set({ message, updatedAt: new Date() }).where(eq(recurringRun.id, result.runId));
    }
  }
  return { templateId: template.id, periodDate, status: result.runId ? "GENERATED" : "SKIPPED", runId: result.runId, message };
}

function toExpenseLines(lines: RecurringTemplateLine[]) {
  return lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    retentionRate: line.retentionRate,
    taxDeductiblePct: line.taxDeductiblePct ?? 100,
    ...(line.expenseAccountId ? { expenseAccountId: line.expenseAccountId } : {}),
  }));
}

function expenseIdempotencyKey(templateId: string, periodDate: string) {
  return `recurring:${templateId}:${periodDate}`;
}

async function generateExpensePeriod(template: TemplateRow, periodDate: string, companyContext: CompanyContext): Promise<GenerationOutcome> {
  const lines = renderLines(template.lines, periodDate);
  const notes = template.notes ? renderPeriodText(template.notes, periodDate) : null;
  let supplierInvoiceId: string | null = null;
  let message: string | null = null;
  if (template.issueMode === "POST") {
    try {
      const fiscalYearId = await resolveFiscalYearId(db, companyContext.companyId, periodDate);
      // Idempotente por clave: si un intento anterior ya la registró, devuelve la misma factura.
      const created = await createExpenseInvoice({
        tenantId: companyContext.tenantId,
        companyId: companyContext.companyId,
        fiscalYearId,
        actorUserId: template.createdByUserId ?? companyContext.ownerId,
        supplierPartnerId: template.supplierPartnerId ?? undefined,
        issueDate: new Date(`${periodDate}T00:00:00.000Z`),
        notes: notes ?? undefined,
        lines: toExpenseLines(lines),
        idempotencyKey: expenseIdempotencyKey(template.id, periodDate),
      });
      supplierInvoiceId = created.id;
    } catch (error) {
      message = `No se pudo registrar automáticamente (${errorText(error)}). Queda pendiente de revisar.`;
    }
  }
  const status = supplierInvoiceId ? "GENERATED" : "PENDING_REVIEW";
  const result = await db.transaction(async (tx) => {
    const locked = await lockDueTemplate(tx, template.id, periodDate);
    if (!locked) return null;
    const [run] = await tx
      .insert(recurringRun)
      .values({
        companyId: locked.companyId,
        templateId: locked.id,
        periodDate,
        status,
        supplierInvoiceId,
        payload: supplierInvoiceId ? null : { lines, notes },
        message,
      })
      .onConflictDoNothing({ target: [recurringRun.templateId, recurringRun.periodDate] })
      .returning({ id: recurringRun.id });
    await advanceTemplate(tx, locked, periodDate, Boolean(run));
    return run ?? null;
  });
  return { templateId: template.id, periodDate, status: result ? status : "SKIPPED", runId: result?.id ?? null, message };
}

export type RecurringRunSummary = { templates: number; generated: number; pendingReview: number; failed: number };

/**
 * Genera todos los periodos vencidos (hasta hoy, en la zona horaria de cada empresa). Se puede
 * ejecutar tantas veces como se quiera: cada periodo se genera una sola vez.
 */
export async function runDueRecurringTemplates(options: { now?: Date; transport?: MailTransport | null; maxPeriodsPerTemplate?: number } = {}): Promise<RecurringRunSummary> {
  const now = options.now ?? new Date();
  // Filtro amplio en SQL (mañana en UTC) y exacto por zona horaria de la empresa en JS.
  const horizon = todayDateInput("UTC", new Date(now.getTime() + 36 * 60 * 60 * 1000));
  const candidates = await db
    .select({
      template: recurringTemplate,
      tenantId: company.tenantId,
      countryCode: company.countryCode,
      timezone: company.timezone,
      ownerId: tenant.ownerId,
    })
    .from(recurringTemplate)
    .innerJoin(company, eq(company.id, recurringTemplate.companyId))
    .innerJoin(tenant, eq(tenant.id, company.tenantId))
    .where(and(eq(recurringTemplate.status, "ACTIVE"), isNotNull(recurringTemplate.nextRunDate), lte(recurringTemplate.nextRunDate, horizon)))
    .orderBy(asc(recurringTemplate.nextRunDate), asc(recurringTemplate.id))
    .limit(500);
  const summary: RecurringRunSummary = { templates: 0, generated: 0, pendingReview: 0, failed: 0 };
  for (const candidate of candidates) {
    const companyContext: CompanyContext = {
      tenantId: candidate.tenantId,
      companyId: candidate.template.companyId,
      countryCode: candidate.countryCode,
      timeZone: candidate.timezone || undefined,
      ownerId: candidate.ownerId,
    };
    const today = todayDateInput(companyContext.timeZone, now);
    let template: TemplateRow = candidate.template;
    let processed = false;
    for (let step = 0; step < (options.maxPeriodsPerTemplate ?? 12); step += 1) {
      const periodDate = template.nextRunDate;
      if (!periodDate || periodDate > today || template.status !== "ACTIVE") break;
      processed = true;
      try {
        const outcome = template.kind === "EXPENSE"
          ? await generateExpensePeriod(template, periodDate, companyContext)
          : await generateInvoicePeriod(template, periodDate, companyContext, { transport: options.transport });
        if (outcome.status === "GENERATED") summary.generated += 1;
        if (outcome.status === "PENDING_REVIEW") summary.pendingReview += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error({ err: error, templateId: template.id, periodDate }, "recurring.generate_failed");
        await db
          .update(recurringTemplate)
          .set({ lastError: `${periodDate}: ${errorText(error)}`, lastRunAt: new Date() })
          .where(eq(recurringTemplate.id, template.id));
        break;
      }
      const [reloaded] = await db.select().from(recurringTemplate).where(eq(recurringTemplate.id, template.id)).limit(1);
      if (!reloaded || reloaded.nextRunDate === periodDate) break;
      template = reloaded;
    }
    if (processed) summary.templates += 1;
  }
  return summary;
}

async function lockPendingRun(tx: DbClient, companyId: string, runId: string) {
  const [row] = await tx
    .select({ run: recurringRun, template: recurringTemplate })
    .from(recurringRun)
    .innerJoin(recurringTemplate, eq(recurringTemplate.id, recurringRun.templateId))
    .where(and(eq(recurringRun.id, runId), eq(recurringRun.companyId, companyId)))
    .for("update", { of: recurringRun })
    .limit(1);
  return row ?? null;
}

/**
 * Registra un gasto recurrente pendiente de revisar. Permite ajustar el importe de cada línea
 * (recibos variables: luz, teléfono) y el número de factura del proveedor.
 */
export async function confirmPendingExpenseRun(
  actor: RecurringActor & { fiscalYearId: string },
  runId: string,
  input: { unitPrices?: number[]; supplierDocumentNumber?: string | null },
) {
  const [pending] = await db
    .select({ run: recurringRun, template: recurringTemplate })
    .from(recurringRun)
    .innerJoin(recurringTemplate, eq(recurringTemplate.id, recurringRun.templateId))
    .where(and(eq(recurringRun.id, runId), eq(recurringRun.companyId, actor.companyId)))
    .limit(1);
  if (!pending) return null;
  if (pending.run.status !== "PENDING_REVIEW" || !pending.run.payload) throw new HttpError(409, "Este gasto ya se registró o se descartó.");
  const lines = pending.run.payload.lines.map((line, index) => {
    const override = input.unitPrices?.[index];
    return typeof override === "number" && Number.isFinite(override) && override >= 0 ? { ...line, unitPrice: Math.round(override * 100) / 100 } : line;
  });
  let created: { id: string; number: string };
  try {
    created = await createExpenseInvoice({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      fiscalYearId: actor.fiscalYearId,
      actorUserId: actor.actorUserId,
      supplierPartnerId: pending.template.supplierPartnerId ?? undefined,
      supplierDocumentNumber: input.supplierDocumentNumber?.trim() || undefined,
      issueDate: new Date(`${pending.run.periodDate}T00:00:00.000Z`),
      notes: pending.run.payload.notes ?? undefined,
      lines: toExpenseLines(lines),
      idempotencyKey: expenseIdempotencyKey(pending.template.id, pending.run.periodDate),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // El servicio de gastos lanza `Error` con mensajes pensados para el usuario (duplicados, periodo cerrado…).
    throw new HttpError(400, errorText(error));
  }
  return db.transaction(async (tx) => {
    const locked = await lockPendingRun(tx, actor.companyId, runId);
    if (!locked || locked.run.status !== "PENDING_REVIEW") return { runId, supplierInvoiceId: created.id, number: created.number };
    await tx
      .update(recurringRun)
      .set({ status: "GENERATED", supplierInvoiceId: created.id, payload: null, message: null, updatedAt: new Date() })
      .where(eq(recurringRun.id, runId));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "recurringRun.confirm",
      entityName: "recurringRun",
      entityId: runId,
      payload: { templateId: pending.template.id, periodDate: pending.run.periodDate, supplierInvoiceId: created.id },
    }, tx);
    return { runId, supplierInvoiceId: created.id, number: created.number };
  });
}

export async function discardPendingRun(actor: RecurringActor, runId: string) {
  return db.transaction(async (tx) => {
    const locked = await lockPendingRun(tx, actor.companyId, runId);
    if (!locked) return null;
    if (locked.run.status !== "PENDING_REVIEW") throw new HttpError(409, "Solo se pueden descartar gastos pendientes de revisar.");
    await tx.update(recurringRun).set({ status: "DISCARDED", updatedAt: new Date() }).where(eq(recurringRun.id, runId));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "recurringRun.discard",
      entityName: "recurringRun",
      entityId: runId,
      payload: { templateId: locked.template.id, periodDate: locked.run.periodDate },
    }, tx);
    return { runId };
  });
}

/** Gastos recurrentes pendientes de revisar (para el aviso en /expenses/recurring). */
export async function listPendingExpenseRuns(companyId: string) {
  const rows = await db
    .select({ run: recurringRun, templateName: recurringTemplate.name, supplierName: partner.name })
    .from(recurringRun)
    .innerJoin(recurringTemplate, eq(recurringTemplate.id, recurringRun.templateId))
    .leftJoin(partner, eq(partner.id, recurringTemplate.supplierPartnerId))
    .where(and(eq(recurringRun.companyId, companyId), eq(recurringRun.status, "PENDING_REVIEW"), eq(recurringTemplate.kind, "EXPENSE")))
    .orderBy(asc(recurringRun.periodDate), asc(recurringRun.id))
    .limit(200);
  return rows.map(({ run, supplierName, templateName }) => ({
    id: run.id,
    templateId: run.templateId,
    templateName,
    supplierName: supplierName ?? "—",
    periodDate: run.periodDate,
    message: run.message,
    lines: run.payload?.lines ?? [],
    estimatedTotal: run.payload ? estimateTemplateTotal(run.payload.lines) : 0,
  }));
}
