/**
 * Bandeja de salida del SII. No engancha en la emisión de facturas: un proceso recorre las
 * facturas expedidas y recibidas de las empresas con el SII activado y deja en `sii_record` lo que
 * hay que comunicar a la AEAT (alta, modificación o baja). El envío lo hace `sender.ts`.
 */
import { createHash } from "node:crypto";

import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import { company, companySettings, customer, invoice, invoiceLine, invoiceLineTax, item, partner, siiRecord, siiSettings, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import { standardVatRate } from "@/lib/country-packs/vat-rates";
import { fiscalCivilDate, localMidnightInstant, resolveSalesVatTreatment, resolveSupplierVatTreatment } from "@/lib/fiscal-spain";
import type { InvoiceCalculationTax } from "@/lib/invoice-totals";
import { DRAFT_NUMBER_PREFIX } from "@/server/invoices/lifecycle";
import { readSiiEnvironment, type SiiEnvironment } from "@/server/sii/config";
import { civilKey, parseExtraHolidays, siiDeadline } from "@/server/sii/deadlines";
import { civilDateOf, mapIssuedInvoice, mapReceivedInvoice, type SiiIssuedSource, type SiiReceivedSource } from "@/server/sii/mapping";
import type { SiiBook, SiiOperation, SiiRecordPayload, SiiStatus } from "@/server/sii/types";

const BATCH = 500;

// ── Decisión pura: qué hacer con una factura según su historial ──────────────────────────────

export type OutboxHistoryEntry = { id: string; operation: SiiOperation; status: SiiStatus; contentHash: string };

export type OutboxAction =
  | { kind: "none" }
  | { kind: "create"; operation: SiiOperation }
  /** Actualiza el contenido de la comunicación pendiente (aún no ha salido). */
  | { kind: "update"; recordId: string }
  /** La factura se anuló antes de suministrarse: la comunicación pendiente sobra. */
  | { kind: "delete"; recordId: string }
  /** Había una modificación pendiente de una factura que consta en el SII y se ha anulado: pasa a ser baja. */
  | { kind: "to-cancellation"; recordId: string };

const ACCEPTED: ReadonlySet<SiiStatus> = new Set(["ACCEPTED", "ACCEPTED_WITH_ERRORS"]);

/** ¿Consta la factura en el SII? Lo dice la última comunicación aceptada: un alta o modificación sí, una baja no. */
export function isRegisteredInSii(history: OutboxHistoryEntry[]) {
  const accepted = history.filter((entry) => ACCEPTED.has(entry.status));
  const last = accepted[accepted.length - 1];
  return Boolean(last && last.operation !== "BAJA");
}

/**
 * Qué comunicación necesita una factura. `history` va de la más antigua a la más reciente.
 * - Sin comunicar → alta (A0). Si ya consta en el SII y su contenido ha cambiado → modificación (A1).
 * - Anulada → baja si consta en el SII; si aún no había salido, se descarta lo pendiente.
 * - Rechazada sin cambios → nada: el usuario ve el error y decide (corregir la factura o reenviar).
 * - Enviada sin respuesta concluyente (SENT) → nada hasta que se aclare.
 */
export function planOutboxAction(input: { live: boolean; contentHash: string | null; history: OutboxHistoryEntry[] }): OutboxAction {
  const latest = input.history[input.history.length - 1];
  const registered = isRegisteredInSii(input.history);

  if (!input.live) {
    if (!latest) return { kind: "none" };
    if (latest.status === "SENT") return { kind: "none" };
    if (latest.status === "PENDING") {
      if (latest.operation === "BAJA") return { kind: "none" };
      return registered ? { kind: "to-cancellation", recordId: latest.id } : { kind: "delete", recordId: latest.id };
    }
    if (latest.operation === "BAJA") return { kind: "none" }; // aceptada, o rechazada y a la vista
    return registered ? { kind: "create", operation: "BAJA" } : { kind: "none" };
  }

  if (!input.contentHash) return { kind: "none" };
  const next: SiiOperation = registered ? "A1" : "A0";
  if (!latest) return { kind: "create", operation: "A0" };
  if (latest.status === "SENT") return { kind: "none" };
  if (latest.status === "PENDING") {
    // Una baja pendiente de una factura que vuelve a estar viva no tiene sentido: se sustituye.
    if (latest.operation === "BAJA") return { kind: "update", recordId: latest.id };
    return latest.contentHash === input.contentHash ? { kind: "none" } : { kind: "update", recordId: latest.id };
  }
  if (latest.operation === "BAJA") return ACCEPTED.has(latest.status) ? { kind: "create", operation: "A0" } : { kind: "none" };
  return latest.contentHash === input.contentHash ? { kind: "none" } : { kind: "create", operation: next };
}

export function payloadHash(payload: SiiRecordPayload, problems: string[]) {
  return createHash("sha256").update(JSON.stringify([payload, problems])).digest("hex");
}

// ── Empresa: ¿puede usar el SII de la AEAT? ─────────────────────────────────────────────────

export type SiiCompanyProfile = {
  id: string;
  name: string;
  vatNumber: string | null;
  countryCode: string;
  timezone: string;
  territory: string | null;
  siiEnabled: boolean;
  fiscalRegime: string;
  businessType: string;
};

export type SiiEligibility = { enabled: boolean; supported: boolean; reason: string | null };

/**
 * El SII que implementa este módulo es el de la AEAT (territorio común). Fuera quedan Canarias
 * (SII del IGIC, de la Agencia Tributaria Canaria), Ceuta y Melilla, y el régimen especial del
 * criterio de caja (exige además suministrar cobros y pagos, que no está implementado).
 */
export function siiEligibility(profile: Pick<SiiCompanyProfile, "siiEnabled" | "countryCode" | "territory" | "fiscalRegime">): SiiEligibility {
  if (!profile.siiEnabled) return { enabled: false, supported: false, reason: "El SII no está activado en esta empresa." };
  if (!getCountryFiscalProfile(profile.countryCode).features.taxReports) {
    return { enabled: true, supported: false, reason: "El SII solo existe para empresas españolas." };
  }
  if (profile.territory && profile.territory !== "ES") {
    return { enabled: true, supported: false, reason: "Solo se suministra al SII de la AEAT (Península y Baleares). El SII de Canarias (IGIC) y las operaciones de Ceuta y Melilla no están cubiertos." };
  }
  if (profile.fiscalRegime === "cash_accounting") {
    return { enabled: true, supported: false, reason: "El régimen especial del criterio de caja exige suministrar también los cobros y pagos, que todavía no está disponible: no se envía nada para no dejar registros incompletos." };
  }
  return { enabled: true, supported: true, reason: null };
}

export async function loadSiiCompanyProfile(client: DbClient, companyId: string): Promise<SiiCompanyProfile | null> {
  const [row] = await client
    .select({
      id: company.id,
      name: company.name,
      legalName: company.legalName,
      vatNumber: company.vatNumber,
      countryCode: company.countryCode,
      postalCode: company.postalCode,
      province: company.province,
      timezone: company.timezone,
      siiEnabled: companySettings.siiEnabled,
      fiscalRegime: companySettings.fiscalRegime,
      businessType: companySettings.businessType,
    })
    .from(company)
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .where(eq(company.id, companyId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.legalName?.trim() || row.name,
    vatNumber: row.vatNumber,
    countryCode: row.countryCode,
    timezone: row.timezone || "Europe/Madrid",
    territory: taxTerritoryOf(row),
    siiEnabled: row.siiEnabled ?? false,
    fiscalRegime: row.fiscalRegime ?? "general",
    businessType: row.businessType ?? "both",
  };
}

/** Fecha desde la que se suministra: por defecto, el 1 de enero del año en curso (el SII abarca el año natural). */
export async function ensureSiiSettings(client: DbClient, profile: Pick<SiiCompanyProfile, "id" | "timezone">, now = new Date()) {
  const [existing] = await client.select().from(siiSettings).where(eq(siiSettings.companyId, profile.id)).limit(1);
  if (existing) return existing;
  const since = localMidnightInstant(fiscalCivilDate(now, profile.timezone).year, 0, 1, profile.timezone);
  await client.insert(siiSettings).values({ companyId: profile.id, since }).onConflictDoNothing();
  const [created] = await client.select().from(siiSettings).where(eq(siiSettings.companyId, profile.id)).limit(1);
  return created;
}

// ── Lectura de las facturas (consultas propias: no se tocan los módulos de facturas) ────────

type MappedDocument = {
  sourceId: string;
  live: boolean;
  payload: SiiRecordPayload | null;
  problems: string[];
  dueDate: string | null;
};

async function loadIssuedDocuments(client: DbClient, profile: SiiCompanyProfile, since: Date, extraHolidays: string[]): Promise<MappedDocument[]> {
  const rows = await client
    .select({
      id: invoice.id,
      number: invoice.number,
      issueDate: invoice.issueDate,
      operationDate: invoice.operationDate,
      status: invoice.status,
      invoiceType: invoice.invoiceType,
      vatTreatment: invoice.vatTreatment,
      vatExemptionCode: invoice.vatExemptionCode,
      rectifiedInvoiceId: invoice.rectifiedInvoiceId,
      rectificationReason: invoice.rectificationReason,
      rectificationDescription: invoice.rectificationDescription,
      issuerSnapshot: invoice.issuerSnapshot,
      customerSnapshot: invoice.customerSnapshot,
      customerName: customer.name,
      partnerName: partner.name,
      partnerTaxId: partner.taxId,
      partnerCountry: partner.countryCode,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(
      eq(invoice.companyId, profile.id),
      gte(invoice.issueDate, since),
      // Los borradores del ciclo borrador → emisión (número provisional) no son facturas todavía.
      sql`${invoice.number} NOT LIKE ${`${DRAFT_NUMBER_PREFIX}%`}`,
    ))
    .orderBy(asc(invoice.issueDate), asc(invoice.number));

  // Facturas rectificadas (pueden ser anteriores a la fecha de inicio).
  const originalIds = [...new Set(rows.map((row) => row.rectifiedInvoiceId).filter((id): id is string => Boolean(id)))];
  const originals = new Map<string, { number: string; issueDate: Date; simplified: boolean }>();
  for (let offset = 0; offset < originalIds.length; offset += BATCH) {
    const found = await client
      .select({ id: invoice.id, number: invoice.number, issueDate: invoice.issueDate, customerSnapshot: invoice.customerSnapshot, partnerTaxId: partner.taxId })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(and(eq(invoice.companyId, profile.id), inArray(invoice.id, originalIds.slice(offset, offset + BATCH))));
    for (const original of found) {
      const taxId = original.customerSnapshot ? original.customerSnapshot.taxId : original.partnerTaxId;
      originals.set(original.id, { number: original.number, issueDate: original.issueDate, simplified: !taxId?.trim() });
    }
  }

  const documents: MappedDocument[] = [];
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = rows.slice(offset, offset + BATCH);
    const live = batch.filter((row) => row.status !== "VOID");
    const lines = live.length === 0 ? [] : await client
      .select({
        id: invoiceLine.id,
        invoiceId: invoiceLine.invoiceId,
        description: invoiceLine.description,
        quantity: invoiceLine.quantity,
        unitPrice: invoiceLine.unitPrice,
        discountPct: invoiceLine.discountPct,
        taxRate: invoiceLine.taxRate,
        retentionRate: invoiceLine.retentionRate,
        isService: item.isService,
      })
      .from(invoiceLine)
      .leftJoin(item, eq(item.id, invoiceLine.itemId))
      .where(inArray(invoiceLine.invoiceId, live.map((row) => row.id)))
      .orderBy(asc(sql`${invoiceLine}.ctid`));
    const taxesByLine = new Map<string, InvoiceCalculationTax[]>();
    for (let lineOffset = 0; lineOffset < lines.length; lineOffset += BATCH) {
      const taxes = await client
        .select({ invoiceLineId: invoiceLineTax.invoiceLineId, taxId: invoiceLineTax.taxId, name: invoiceLineTax.name, rate: invoiceLineTax.rate, kind: invoiceLineTax.kind, operation: invoiceLineTax.operation })
        .from(invoiceLineTax)
        .where(inArray(invoiceLineTax.invoiceLineId, lines.slice(lineOffset, lineOffset + BATCH).map((line) => line.id)));
      for (const tax of taxes) {
        taxesByLine.set(tax.invoiceLineId, [
          ...(taxesByLine.get(tax.invoiceLineId) ?? []),
          { id: tax.taxId, name: tax.name, rate: Number(tax.rate), kind: tax.kind, operation: tax.operation === "SUBTRACT" ? "SUBTRACT" : "ADD" },
        ]);
      }
    }
    const linesByInvoice = new Map<string, SiiIssuedSource["lines"]>();
    for (const line of lines) {
      const taxes = taxesByLine.get(line.id);
      linesByInvoice.set(line.invoiceId, [...(linesByInvoice.get(line.invoiceId) ?? []), {
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discountPct: Number(line.discountPct),
        taxRate: Number(line.taxRate),
        retentionRate: Number(line.retentionRate),
        // Con impuestos congelados en la línea mandan esos; las facturas antiguas solo tienen `taxRate`.
        ...(taxes ? { taxes } : {}),
        isService: line.isService,
      }]);
    }

    for (const row of batch) {
      if (row.status === "VOID") {
        documents.push({ sourceId: row.id, live: false, payload: null, problems: [], dueDate: null });
        continue;
      }
      const customerData = row.customerSnapshot
        ? { name: row.customerSnapshot.legalName?.trim() || row.customerSnapshot.name, taxId: row.customerSnapshot.taxId, countryCode: row.customerSnapshot.countryCode }
        : { name: row.partnerName ?? row.customerName, taxId: row.partnerTaxId, countryCode: row.partnerCountry };
      const mapped = mapIssuedInvoice({
        number: row.number,
        issueDate: row.issueDate,
        operationDate: row.operationDate,
        invoiceType: row.invoiceType,
        rectificationReason: row.rectificationReason,
        rectificationDescription: row.rectificationDescription,
        vatTreatment: resolveSalesVatTreatment(row.vatTreatment, customerData.countryCode, profile.countryCode),
        exemptionCode: row.vatExemptionCode,
        // El titular del libro es la empresa tal y como está hoy (el NIF del emisor no cambia).
        holder: { name: profile.name, nif: row.issuerSnapshot?.taxId?.trim() || profile.vatNumber },
        customer: customerData,
        lines: linesByInvoice.get(row.id) ?? [],
        original: row.rectifiedInvoiceId ? originals.get(row.rectifiedInvoiceId) ?? null : null,
        timeZone: profile.timezone,
        servicesByDefault: profile.businessType === "services",
      });
      const problems = [...mapped.problems];
      if ((linesByInvoice.get(row.id) ?? []).length === 0) problems.push("La factura no tiene líneas.");
      documents.push({
        sourceId: row.id,
        live: true,
        payload: { book: "ISSUED", invoice: mapped.invoice },
        problems,
        dueDate: civilKey(siiDeadline({
          start: civilDateOf(row.issueDate, profile.timezone),
          accrual: civilDateOf(row.operationDate ?? row.issueDate, profile.timezone),
          extraHolidays,
        })),
      });
    }
  }
  return documents;
}

async function loadReceivedDocuments(client: DbClient, profile: SiiCompanyProfile, since: Date, extraHolidays: string[]): Promise<MappedDocument[]> {
  const rectified = supplierInvoice;
  const rows = await client
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      issueDate: supplierInvoice.issueDate,
      accountingDate: supplierInvoice.accountingDate,
      operationDate: supplierInvoice.operationDate,
      status: supplierInvoice.status,
      documentKind: supplierInvoice.documentKind,
      rectifiedInvoiceId: supplierInvoice.rectifiedInvoiceId,
      rectifiedDocumentNumber: supplierInvoice.rectifiedDocumentNumber,
      rectifiedIssueDate: supplierInvoice.rectifiedIssueDate,
      rectificationReason: supplierInvoice.rectificationReason,
      isSimplified: supplierInvoice.isSimplified,
      vatTreatment: supplierInvoice.vatTreatment,
      importDuaNumber: supplierInvoice.importDuaNumber,
      importDuaDate: supplierInvoice.importDuaDate,
      prorrataPct: supplierInvoice.prorrataPct,
      supplierName: partner.name,
      supplierTaxId: partner.taxId,
      supplierCountry: partner.countryCode,
      supplierKind: partner.supplierKind,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(eq(supplierInvoice.companyId, profile.id), gte(supplierInvoice.accountingDate, since), ne(supplierInvoice.status, "DRAFT")))
    .orderBy(asc(supplierInvoice.accountingDate), asc(supplierInvoice.number));

  const rectifiedIds = [...new Set(rows.filter((row) => row.rectifiedInvoiceId && !(row.rectifiedDocumentNumber && row.rectifiedIssueDate)).map((row) => row.rectifiedInvoiceId!))];
  const rectifiedById = new Map<string, { number: string | null; issueDate: Date }>();
  for (let offset = 0; offset < rectifiedIds.length; offset += BATCH) {
    const found = await client
      .select({ id: rectified.id, number: rectified.number, supplierDocumentNumber: rectified.supplierDocumentNumber, issueDate: rectified.issueDate })
      .from(rectified)
      .where(and(eq(rectified.companyId, profile.id), inArray(rectified.id, rectifiedIds.slice(offset, offset + BATCH))));
    for (const original of found) rectifiedById.set(original.id, { number: original.supplierDocumentNumber?.trim() || original.number, issueDate: original.issueDate });
  }

  const documents: MappedDocument[] = [];
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = rows.slice(offset, offset + BATCH);
    const live = batch.filter((row) => row.status !== "VOID");
    const lines = live.length === 0 ? [] : await client
      .select({
        supplierInvoiceId: supplierInvoiceLine.supplierInvoiceId,
        description: supplierInvoiceLine.description,
        subtotal: supplierInvoiceLine.subtotalAmount,
        taxAmount: supplierInvoiceLine.taxAmount,
        taxRate: supplierInvoiceLine.taxRate,
        taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
        surchargeRate: supplierInvoiceLine.surchargeRate,
        surchargeAmount: supplierInvoiceLine.surchargeAmount,
        isInvestmentGood: supplierInvoiceLine.isInvestmentGood,
      })
      .from(supplierInvoiceLine)
      .where(inArray(supplierInvoiceLine.supplierInvoiceId, live.map((row) => row.id)))
      .orderBy(asc(sql`${supplierInvoiceLine}.ctid`));
    const linesByInvoice = new Map<string, SiiReceivedSource["lines"]>();
    for (const { supplierInvoiceId, ...line } of lines) linesByInvoice.set(supplierInvoiceId, [...(linesByInvoice.get(supplierInvoiceId) ?? []), line]);

    for (const row of batch) {
      if (row.status === "VOID") {
        documents.push({ sourceId: row.id, live: false, payload: null, problems: [], dueDate: null });
        continue;
      }
      const original = row.rectifiedDocumentNumber && row.rectifiedIssueDate
        ? { number: row.rectifiedDocumentNumber, issueDate: row.rectifiedIssueDate }
        : row.rectifiedInvoiceId ? rectifiedById.get(row.rectifiedInvoiceId) ?? null : null;
      const mapped = mapReceivedInvoice({
        number: row.number,
        supplierDocumentNumber: row.supplierDocumentNumber,
        issueDate: row.issueDate,
        accountingDate: row.accountingDate,
        operationDate: row.operationDate,
        documentKind: row.documentKind,
        rectificationReason: row.rectificationReason,
        rectified: original,
        isSimplified: row.isSimplified,
        vatTreatment: resolveSupplierVatTreatment(row.vatTreatment, row.supplierCountry, row.supplierKind, profile.countryCode),
        importDuaNumber: row.importDuaNumber,
        importDuaDate: row.importDuaDate,
        prorrataPct: Number(row.prorrataPct),
        holder: { name: profile.name, nif: profile.vatNumber },
        supplier: { name: row.supplierName, taxId: row.supplierTaxId, countryCode: row.supplierCountry },
        lines: linesByInvoice.get(row.id) ?? [],
        timeZone: profile.timezone,
        selfAssessmentRate: standardVatRate(profile.countryCode) || 21,
      });
      const problems = [...mapped.problems];
      if ((linesByInvoice.get(row.id) ?? []).length === 0) problems.push("La factura no tiene líneas.");
      const accounting = civilDateOf(row.accountingDate, profile.timezone);
      documents.push({
        sourceId: row.id,
        live: true,
        payload: { book: "RECEIVED", invoice: mapped.invoice },
        problems,
        dueDate: civilKey(siiDeadline({ start: accounting, accrual: accounting, extraHolidays })),
      });
    }
  }
  return documents;
}

// ── Sincronización de la bandeja ────────────────────────────────────────────────────────────

function recordColumns(payload: SiiRecordPayload) {
  const { invoice: content } = payload;
  const counterparty = payload.book === "ISSUED" ? payload.invoice.counterparty?.name ?? null : payload.invoice.issuer.name;
  return {
    fiscalYear: content.period.year,
    period: content.period.period,
    invoiceNumber: content.number || "(sin número)",
    invoiceDate: content.issueDate,
    invoiceTypeCode: content.invoiceType,
    counterpartyName: counterparty,
    totalAmount: content.totalAmount ?? null,
  };
}

export type SiiDetectionSummary = { companyId: string; created: number; updated: number; cancelled: number; discarded: number; skipped: string | null };

async function syncBook(client: DbClient, companyId: string, environment: SiiEnvironment, book: SiiBook, documents: MappedDocument[], summary: SiiDetectionSummary) {
  if (documents.length === 0) return;
  const history = new Map<string, OutboxHistoryEntry[]>();
  const existing = await client
    .select({ id: siiRecord.id, sourceId: siiRecord.sourceId, operation: siiRecord.operation, status: siiRecord.status, contentHash: siiRecord.contentHash })
    .from(siiRecord)
    .where(and(eq(siiRecord.companyId, companyId), eq(siiRecord.environment, environment), eq(siiRecord.book, book)))
    .orderBy(asc(siiRecord.createdAt), asc(siiRecord.id));
  for (const row of existing) {
    history.set(row.sourceId, [...(history.get(row.sourceId) ?? []), { id: row.id, operation: row.operation as SiiOperation, status: row.status as SiiStatus, contentHash: row.contentHash }]);
  }

  for (const document of documents) {
    const entries = history.get(document.sourceId) ?? [];
    const contentHash = document.payload ? payloadHash(document.payload, document.problems) : null;
    const action = planOutboxAction({ live: document.live, contentHash, history: entries });
    if (action.kind === "none") continue;
    const now = new Date();
    const blockedReason = document.problems.length > 0 ? document.problems.join(" ") : null;

    if (action.kind === "delete") {
      await client.delete(siiRecord).where(and(eq(siiRecord.id, action.recordId), eq(siiRecord.status, "PENDING")));
      summary.discarded += 1;
      continue;
    }
    if (action.kind === "to-cancellation" || (action.kind === "create" && action.operation === "BAJA")) {
      // La baja lleva la clave y el periodo con los que la factura consta en el SII: los de su última comunicación aceptada.
      const accepted = [...entries].reverse().find((entry) => ACCEPTED.has(entry.status) && entry.operation !== "BAJA");
      if (!accepted) continue;
      const [registered] = await client.select().from(siiRecord).where(eq(siiRecord.id, accepted.id)).limit(1);
      if (!registered) continue;
      const values = {
        operation: "BAJA",
        fiscalYear: registered.fiscalYear,
        period: registered.period,
        invoiceNumber: registered.invoiceNumber,
        invoiceDate: registered.invoiceDate,
        invoiceTypeCode: registered.invoiceTypeCode,
        counterpartyName: registered.counterpartyName,
        totalAmount: registered.totalAmount,
        payload: registered.payload,
        contentHash: registered.contentHash,
        dueDate: null,
        blockedReason: null,
        attempts: 0,
        nextAttemptAt: null,
        aeatErrorCode: null,
        aeatErrorMessage: null,
        updatedAt: now,
      };
      if (action.kind === "to-cancellation") {
        await client.update(siiRecord).set(values).where(and(eq(siiRecord.id, action.recordId), eq(siiRecord.status, "PENDING")));
      } else {
        await client.insert(siiRecord).values({ companyId, book, sourceId: document.sourceId, environment, status: "PENDING", ...values }).onConflictDoNothing();
      }
      summary.cancelled += 1;
      continue;
    }

    if (!document.payload || !contentHash) continue;
    const values = {
      ...recordColumns(document.payload),
      payload: document.payload as unknown as Record<string, unknown>,
      contentHash,
      blockedReason,
      updatedAt: now,
    };
    if (action.kind === "update") {
      const registered = isRegisteredInSii(entries);
      await client
        .update(siiRecord)
        .set({ ...values, operation: registered ? "A1" : "A0", dueDate: registered ? null : document.dueDate, attempts: 0, nextAttemptAt: null, aeatErrorCode: null, aeatErrorMessage: null })
        .where(and(eq(siiRecord.id, action.recordId), eq(siiRecord.status, "PENDING")));
      summary.updated += 1;
    } else {
      await client
        .insert(siiRecord)
        // El plazo legal es el del alta; una modificación no tiene uno propio.
        .values({ companyId, book, sourceId: document.sourceId, environment, operation: action.operation, status: "PENDING", ...values, dueDate: action.operation === "A0" ? document.dueDate : null })
        .onConflictDoNothing();
      summary.created += 1;
    }
  }
}

/** Revisa las facturas de una empresa y deja en la bandeja lo que falta por comunicar. */
export async function detectSiiRecords(companyId: string, options: { client?: DbClient; env?: Record<string, string | undefined>; now?: Date } = {}): Promise<SiiDetectionSummary> {
  const client = options.client ?? db;
  const env = options.env ?? process.env;
  const summary: SiiDetectionSummary = { companyId, created: 0, updated: 0, cancelled: 0, discarded: 0, skipped: null };
  const profile = await loadSiiCompanyProfile(client, companyId);
  if (!profile) return { ...summary, skipped: "Empresa no encontrada." };
  const eligibility = siiEligibility(profile);
  if (!eligibility.supported) return { ...summary, skipped: eligibility.reason };
  const environment = readSiiEnvironment(env);
  if (!environment.environment) return { ...summary, skipped: environment.problem };

  const settings = await ensureSiiSettings(client, profile, options.now);
  const extraHolidays = parseExtraHolidays(env.SII_EXTRA_HOLIDAYS);
  const issuedDocuments = await loadIssuedDocuments(client, profile, settings.since, extraHolidays);
  await syncBook(client, companyId, environment.environment, "ISSUED", issuedDocuments, summary);
  await syncBook(client, companyId, environment.environment, "RECEIVED", await loadReceivedDocuments(client, profile, settings.since, extraHolidays), summary);
  await client.update(siiSettings).set({ lastDetectionAt: options.now ?? new Date(), updatedAt: new Date() }).where(eq(siiSettings.companyId, companyId));
  return summary;
}

/** Empresas con el SII activado. */
export async function listSiiCompanyIds(client: DbClient = db): Promise<string[]> {
  const rows = await client.select({ companyId: companySettings.companyId }).from(companySettings).where(eq(companySettings.siiEnabled, true));
  return rows.map((row) => row.companyId);
}
