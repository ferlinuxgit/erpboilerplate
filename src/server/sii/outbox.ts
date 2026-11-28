/**
 * Bandeja de salida del SII. No engancha en la emisión de facturas: un proceso recorre las
 * facturas expedidas y recibidas de las empresas con el SII activado y deja en `sii_record` lo que
 * hay que comunicar a la AEAT (alta, modificación o baja). El envío lo hace `sender.ts`.
 */
import { createHash } from "node:crypto";

import { and, asc, eq, gte, inArray, lt, ne, notInArray, or, sql } from "drizzle-orm";

import { accountChart, company, companySettings, customer, fixedAsset, invoice, invoiceLine, invoiceLineTax, invoicePayment, item, partner, payment, paymentMethod, siiRecord, siiSettings, supplierInvoice, supplierInvoiceLine, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import { standardVatRate } from "@/lib/country-packs/vat-rates";
import { fiscalCivilDate, localMidnightInstant, resolveSalesVatTreatment, resolveSupplierVatTreatment, reverseChargeTaxAmount } from "@/lib/fiscal-spain";
import type { InvoiceCalculationTax } from "@/lib/invoice-totals";
import { normalizeVatProrataFinal } from "@/server/fiscal/prorrata";
import { DRAFT_NUMBER_PREFIX } from "@/server/invoices/lifecycle";
import { cashMovementsToSend, cashPeriodOf, planCashMovements, siiPaymentMethodCode, type CashSourceMovement } from "@/server/sii/cash";
import { readSiiEnvironment, type SiiEnvironment } from "@/server/sii/config";
import { addSiiBusinessDays, civilKey, parseExtraHolidays, SII_DEADLINE_BUSINESS_DAYS, siiDeadline } from "@/server/sii/deadlines";
import { investmentGoodsDueDate, mapInvestmentGoods, type SiiInvestmentGoodSource } from "@/server/sii/investment-goods";
import { civilDateOf, mapIssuedInvoice, mapReceivedInvoice, SII_CASH_ACCOUNTING_KEY, siiPartyId, type SiiIssuedSource, type SiiReceivedSource } from "@/server/sii/mapping";
import type { SiiBook, SiiCashMovement, SiiCashRecord, SiiOperation, SiiParty, SiiRecordPayload, SiiStatus } from "@/server/sii/types";
import { SII_ANNUAL_PERIOD } from "@/server/sii/xml";
import { formatAeatAmount, formatAeatDate } from "@/server/verifactu/format";

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
  /** Prorrata definitiva confirmada por ejercicio ({ "2026": 83 }): de ella depende el libro de bienes de inversión. */
  vatProrataFinal: Record<string, number>;
};

export type SiiEligibility = { enabled: boolean; supported: boolean; reason: string | null };

/**
 * El SII que implementa este módulo es el de la AEAT (territorio común). Fuera quedan Canarias
 * (SII del IGIC, de la Agencia Tributaria Canaria) y Ceuta y Melilla. Una empresa en el régimen
 * especial del criterio de caja sí se suministra: sus facturas llevan la clave 07 y sus cobros y
 * pagos van en los libros de cobros y de pagos.
 */
export function siiEligibility(profile: Pick<SiiCompanyProfile, "siiEnabled" | "countryCode" | "territory" | "fiscalRegime">): SiiEligibility {
  if (!profile.siiEnabled) return { enabled: false, supported: false, reason: "El SII no está activado en esta empresa." };
  if (!getCountryFiscalProfile(profile.countryCode).features.taxReports) {
    return { enabled: true, supported: false, reason: "El SII solo existe para empresas españolas." };
  }
  if (profile.territory && profile.territory !== "ES") {
    return { enabled: true, supported: false, reason: "Solo se suministra al SII de la AEAT (Península y Baleares). El SII de Canarias (IGIC) y las operaciones de Ceuta y Melilla no están cubiertos." };
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
      vatProrataFinal: companySettings.vatProrataFinal,
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
    vatProrataFinal: normalizeVatProrataFinal(row.vatProrataFinal),
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
  /** Datos para los libros de cobros y pagos (solo facturas vivas). */
  cash?: {
    /** Importe total de la factura (lo que se cobra o se paga), en céntimos. */
    totalCents: number;
    operationDate: Date;
    /** Recibidas: fecha de registro (ningún pago se declara antes). */
    notBefore?: Date | null;
    rectifiedId: string | null;
    counterpartyName: string | null;
  };
};

type LoadOptions = {
  since: Date;
  extraHolidays: string[];
  /** Desde cuándo aplica la empresa el criterio de caja; null si no está en el régimen. */
  cashAccountingSince: Date | null;
};

async function loadIssuedDocuments(client: DbClient, profile: SiiCompanyProfile, options: LoadOptions): Promise<MappedDocument[]> {
  const { since, extraHolidays, cashAccountingSince } = options;
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
      totalAmount: invoice.totalAmount,
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
        // Criterio de caja: operaciones devengadas (regla general) desde que la empresa aplica el régimen.
        cashAccounting: Boolean(cashAccountingSince && (row.operationDate ?? row.issueDate) >= cashAccountingSince),
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
        cash: {
          totalCents: Math.round(Number(row.totalAmount) * 100),
          operationDate: row.operationDate ?? row.issueDate,
          rectifiedId: row.rectifiedInvoiceId,
          counterpartyName: customerData.name,
        },
      });
    }
  }
  return documents;
}

async function loadReceivedDocuments(client: DbClient, profile: SiiCompanyProfile, options: LoadOptions): Promise<MappedDocument[]> {
  const { since, extraHolidays, cashAccountingSince } = options;
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
      totalAmount: supplierInvoice.totalAmount,
      supplierCashAccounting: supplierInvoice.supplierCashAccounting,
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
        // La deducción nace con el pago si el proveedor está en criterio de caja o lo está la empresa.
        cashAccounting: row.supplierCashAccounting || Boolean(cashAccountingSince && (row.operationDate ?? row.issueDate) >= cashAccountingSince),
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
        cash: {
          totalCents: Math.round(Number(row.totalAmount) * 100),
          operationDate: row.operationDate ?? row.issueDate,
          notBefore: row.accountingDate,
          rectifiedId: row.rectifiedInvoiceId,
          counterpartyName: row.supplierName,
        },
      });
    }
  }
  return documents;
}

// ── Sincronización de la bandeja ────────────────────────────────────────────────────────────

function recordColumns(payload: SiiRecordPayload) {
  if (payload.book === "INVESTMENT_GOODS") {
    const { good } = payload;
    return {
      fiscalYear: good.year,
      period: SII_ANNUAL_PERIOD,
      invoiceNumber: good.number || "(sin número)",
      invoiceDate: good.issueDate,
      invoiceTypeCode: null,
      counterpartyName: `${good.goodId} · ${good.issuer.name}`,
      totalAmount: good.annualRegularization ?? null,
    };
  }
  if (payload.book !== "ISSUED" && payload.book !== "RECEIVED") throw new Error("Los cobros y pagos tienen su propia sincronización.");
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

async function syncBook(client: DbClient, companyId: string, environment: SiiEnvironment, book: SiiBook, documents: MappedDocument[], summary: SiiDetectionSummary, options: { discardAbsentPending?: boolean } = {}) {
  if (documents.length === 0 && !options.discardAbsentPending) return;
  const history = new Map<string, OutboxHistoryEntry[]>();
  const existing = await client
    .select({ id: siiRecord.id, sourceId: siiRecord.sourceId, operation: siiRecord.operation, status: siiRecord.status, contentHash: siiRecord.contentHash })
    .from(siiRecord)
    .where(and(eq(siiRecord.companyId, companyId), eq(siiRecord.environment, environment), eq(siiRecord.book, book)))
    .orderBy(asc(siiRecord.createdAt), asc(siiRecord.id));
  for (const row of existing) {
    history.set(row.sourceId, [...(history.get(row.sourceId) ?? []), { id: row.id, operation: row.operation as SiiOperation, status: row.status as SiiStatus, contentHash: row.contentHash }]);
  }

  if (options.discardAbsentPending) {
    // Lo que ya no se deriva de los datos (p. ej. se ha quitado la prorrata definitiva del año) y
    // aún no ha salido se descarta. Lo ya aceptado por la AEAT no se da de baja automáticamente.
    const present = new Set(documents.map((document) => document.sourceId));
    for (const [sourceId, entries] of history) {
      const latest = entries[entries.length - 1];
      if (present.has(sourceId) || latest.status !== "PENDING" || latest.operation === "BAJA") continue;
      await client.delete(siiRecord).where(and(eq(siiRecord.id, latest.id), eq(siiRecord.status, "PENDING")));
      summary.discarded += 1;
    }
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

// ── Cobros y pagos del criterio de caja ─────────────────────────────────────────────────────

type CashDocument = {
  /** Id del cobro o pago (o del abono, o del vencimiento del 31 de diciembre). */
  sourceId: string;
  invoiceSourceId: string;
  issuer: SiiCashRecord["issuer"];
  number: string;
  issueDate: string;
  date: Date;
  target: SiiCashMovement;
  counterpartyName: string | null;
};

type CashInvoice = MappedDocument & { payload: Extract<SiiRecordPayload, { book: "ISSUED" | "RECEIVED" }>; cash: NonNullable<MappedDocument["cash"]> };

/** Facturas vivas con clave 07: las únicas que admiten cobros o pagos (errores 3005 y 3007 de la AEAT). */
function cashInvoices(documents: MappedDocument[]): CashInvoice[] {
  return documents.filter((document): document is CashInvoice => Boolean(
    document.live && document.cash && document.payload
    && (document.payload.book === "ISSUED" || document.payload.book === "RECEIVED")
    && document.payload.invoice.regimeKey === SII_CASH_ACCOUNTING_KEY,
  ));
}

async function loadCollections(client: DbClient, companyId: string, invoiceIds: string[]) {
  const result = new Map<string, CashSourceMovement[]>();
  for (let offset = 0; offset < invoiceIds.length; offset += BATCH) {
    const rows = await client
      .select({ id: invoicePayment.id, invoiceId: invoicePayment.invoiceId, amount: invoicePayment.amountApplied, date: payment.postedAt, methodType: paymentMethod.type, account: paymentMethod.bankAccountNumber })
      .from(invoicePayment)
      .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
      .leftJoin(paymentMethod, eq(paymentMethod.id, payment.paymentMethodId))
      .where(and(eq(invoicePayment.companyId, companyId), inArray(invoicePayment.invoiceId, invoiceIds.slice(offset, offset + BATCH))));
    for (const row of rows) {
      result.set(row.invoiceId, [...(result.get(row.invoiceId) ?? []), { id: row.id, date: row.date, amountCents: Math.round(Number(row.amount) * 100), method: siiPaymentMethodCode(row.methodType), account: row.account }]);
    }
  }
  return result;
}

async function loadSupplierPayments(client: DbClient, companyId: string, invoiceIds: string[]) {
  const result = new Map<string, CashSourceMovement[]>();
  for (let offset = 0; offset < invoiceIds.length; offset += BATCH) {
    const rows = await client
      .select({ id: supplierInvoicePayment.id, invoiceId: supplierInvoicePayment.supplierInvoiceId, amount: supplierInvoicePayment.amountApplied, date: supplierPayment.postedAt, methodType: paymentMethod.type })
      .from(supplierInvoicePayment)
      .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
      .leftJoin(paymentMethod, eq(paymentMethod.id, supplierPayment.paymentMethodId))
      .where(and(eq(supplierInvoicePayment.companyId, companyId), inArray(supplierInvoicePayment.supplierInvoiceId, invoiceIds.slice(offset, offset + BATCH))));
    for (const row of rows) {
      // La cuenta de la forma de pago es la de la empresa, no la del proveedor: no se informa.
      result.set(row.invoiceId, [...(result.get(row.invoiceId) ?? []), { id: row.id, date: row.date, amountCents: Math.round(Number(row.amount) * 100), method: siiPaymentMethodCode(row.methodType) }]);
    }
  }
  return result;
}

/** Cobros o pagos que hay que tener declarados de las facturas con clave 07 de un libro. */
function buildCashDocuments(documents: MappedDocument[], movements: Map<string, CashSourceMovement[]>, timeZone: string, now: Date): CashDocument[] {
  const invoices = cashInvoices(documents);
  // Abonos que compensan una factura: la rectificativa (importe negativo) cuenta como cobro de la rectificada.
  const credits = new Map<string, CashSourceMovement[]>();
  for (const document of documents) {
    if (!document.live || !document.cash?.rectifiedId || document.cash.totalCents >= 0) continue;
    credits.set(document.cash.rectifiedId, [
      ...(credits.get(document.cash.rectifiedId) ?? []),
      { id: `${document.sourceId}:abono`, date: document.cash.notBefore ?? document.cash.operationDate, amountCents: -document.cash.totalCents, method: "04" },
    ]);
  }
  return invoices.flatMap((document) => {
    const { invoice: content } = document.payload;
    const issuer: SiiCashRecord["issuer"] = document.payload.book === "ISSUED" ? { nif: document.payload.invoice.issuerNif } : document.payload.invoice.issuer;
    return planCashMovements({
      invoiceId: document.sourceId,
      operationDate: document.cash.operationDate,
      totalCents: document.cash.totalCents,
      movements: [...(movements.get(document.sourceId) ?? []), ...(credits.get(document.sourceId) ?? [])],
      timeZone,
      now,
      notBefore: document.cash.notBefore,
    }).map((planned) => ({
      sourceId: planned.sourceId,
      invoiceSourceId: document.sourceId,
      issuer,
      number: content.number,
      issueDate: content.issueDate,
      date: planned.date,
      target: planned.movement,
      counterpartyName: document.cash.counterpartyName,
    }));
  });
}

const WAITING_FOR_INVOICE = "La factura todavía no consta en el SII con la clave del criterio de caja (07): este registro se enviará en cuanto la AEAT la acepte.";

function netAmount(movements: SiiCashMovement[]) {
  return formatAeatAmount(movements.reduce((sum, movement) => sum + Math.round(Number(movement.amount) * 100), 0) / 100);
}

/**
 * Sincroniza un libro de cobros o de pagos. Cada registro es un cobro o pago: alta (A0) al
 * aparecer; si cambia después de aceptado, una corrección (A1: anulación en negativo más el nuevo);
 * si desaparece, su anulación (BAJA: el mismo movimiento en negativo). Los tres viajan en el mismo
 * mensaje de suministro: en estos libros no existen ni la modificación ni la baja.
 */
async function syncCashBook(
  client: DbClient,
  input: { companyId: string; environment: SiiEnvironment; book: "ISSUED_COLLECTIONS" | "RECEIVED_PAYMENTS"; parentBook: "ISSUED" | "RECEIVED"; documents: CashDocument[]; liveInvoiceIds: Set<string>; timeZone: string; extraHolidays: string[] },
  summary: SiiDetectionSummary,
) {
  const { companyId, environment, book } = input;
  const scope = and(eq(siiRecord.companyId, companyId), eq(siiRecord.environment, environment));
  const existing = await client
    .select({ id: siiRecord.id, sourceId: siiRecord.sourceId, operation: siiRecord.operation, status: siiRecord.status, contentHash: siiRecord.contentHash, payload: siiRecord.payload })
    .from(siiRecord)
    .where(and(scope, eq(siiRecord.book, book)))
    .orderBy(asc(siiRecord.createdAt), asc(siiRecord.id));
  if (existing.length === 0 && input.documents.length === 0) return;

  // Facturas que constan en el SII con la clave 07 (su última comunicación aceptada).
  const parents = await client
    .select({ sourceId: siiRecord.sourceId, operation: siiRecord.operation, status: siiRecord.status, payload: siiRecord.payload })
    .from(siiRecord)
    .where(and(scope, eq(siiRecord.book, input.parentBook), inArray(siiRecord.status, ["ACCEPTED", "ACCEPTED_WITH_ERRORS"])))
    .orderBy(asc(siiRecord.createdAt), asc(siiRecord.id));
  const registeredParents = new Set<string>();
  for (const parent of parents) {
    const content = parent.payload as unknown as SiiRecordPayload;
    const registered = parent.operation !== "BAJA" && (content.book === "ISSUED" || content.book === "RECEIVED") && content.invoice.regimeKey === SII_CASH_ACCOUNTING_KEY;
    if (registered) registeredParents.add(parent.sourceId);
    else registeredParents.delete(parent.sourceId);
  }

  const history = new Map<string, Array<OutboxHistoryEntry & { payload: SiiCashRecord | null }>>();
  for (const row of existing) {
    const content = row.payload as unknown as SiiRecordPayload;
    const cash = content.book === "ISSUED_COLLECTIONS" || content.book === "RECEIVED_PAYMENTS" ? content.cash : null;
    history.set(row.sourceId, [...(history.get(row.sourceId) ?? []), { id: row.id, operation: row.operation as SiiOperation, status: row.status as SiiStatus, contentHash: row.contentHash, payload: cash }]);
  }
  const documents = new Map(input.documents.map((document) => [document.sourceId, document]));

  for (const sourceId of new Set([...documents.keys(), ...history.keys()])) {
    const document = documents.get(sourceId) ?? null;
    const entries = history.get(sourceId) ?? [];
    const latest = entries[entries.length - 1];
    const accepted = [...entries].reverse().find((entry) => ACCEPTED.has(entry.status));
    const declared = accepted?.payload?.declared ?? [];
    const identity = document ?? latest?.payload ?? null;
    if (!identity) continue;

    if (!document && !input.liveInvoiceIds.has(identity.invoiceSourceId)) {
      // La factura ya no está en criterio de caja o se ha anulado (su baja arrastra sus cobros): lo pendiente sobra.
      if (latest?.status === "PENDING") {
        await client.delete(siiRecord).where(and(eq(siiRecord.id, latest.id), eq(siiRecord.status, "PENDING")));
        summary.discarded += 1;
      }
      continue;
    }

    const problems = registeredParents.has(identity.invoiceSourceId) ? [] : [WAITING_FOR_INVOICE];
    const base = { invoiceSourceId: identity.invoiceSourceId, issuer: identity.issuer, number: identity.number, issueDate: identity.issueDate };
    const contentHash = document ? createHash("sha256").update(JSON.stringify([base, document.target, problems])).digest("hex") : null;
    const action = planOutboxAction({ live: Boolean(document), contentHash, history: entries });
    if (action.kind === "none") continue;
    if (action.kind === "delete") {
      await client.delete(siiRecord).where(and(eq(siiRecord.id, action.recordId), eq(siiRecord.status, "PENDING")));
      summary.discarded += 1;
      continue;
    }

    const registered = isRegisteredInSii(entries);
    const target = document ? [document.target] : [];
    const movements = registered ? cashMovementsToSend(declared, target) : target;
    const pendingId = action.kind === "create" ? null : action.recordId;
    if (movements.length === 0) {
      // Nada que declarar (lo que consta ya es lo correcto): una comunicación pendiente sobra.
      if (pendingId) {
        await client.delete(siiRecord).where(and(eq(siiRecord.id, pendingId), eq(siiRecord.status, "PENDING")));
        summary.discarded += 1;
      }
      continue;
    }
    const operation: SiiOperation = !document ? "BAJA" : registered ? "A1" : "A0";
    const date = document?.date ?? null;
    const period = date ? cashPeriodOf(date, input.timeZone) : null;
    const payload: SiiRecordPayload = { book, cash: { ...base, movements, declared: target } };
    const now = new Date();
    const values = {
      operation,
      fiscalYear: period?.year ?? movements[0].date.slice(6, 10),
      period: period?.period ?? movements[0].date.slice(3, 5),
      invoiceNumber: base.number || "(sin número)",
      invoiceDate: base.issueDate,
      invoiceTypeCode: null,
      counterpartyName: document?.counterpartyName ?? null,
      totalAmount: netAmount(movements),
      payload: payload as unknown as Record<string, unknown>,
      contentHash: contentHash ?? createHash("sha256").update(JSON.stringify(["BAJA", base, movements])).digest("hex"),
      // Cuatro días hábiles desde el cobro o pago; una corrección o una anulación no tienen plazo propio.
      dueDate: operation === "A0" && date ? civilKey(addSiiBusinessDays(civilDateOf(date, input.timeZone), SII_DEADLINE_BUSINESS_DAYS, input.extraHolidays)) : null,
      blockedReason: problems.length > 0 ? problems.join(" ") : null,
      updatedAt: now,
    };
    if (pendingId) {
      await client
        .update(siiRecord)
        .set({ ...values, ...(document ? {} : { counterpartyName: undefined }), attempts: 0, nextAttemptAt: null, aeatErrorCode: null, aeatErrorMessage: null })
        .where(and(eq(siiRecord.id, pendingId), eq(siiRecord.status, "PENDING")));
      if (operation === "BAJA") summary.cancelled += 1;
      else summary.updated += 1;
    } else {
      await client.insert(siiRecord).values({ companyId, book, sourceId, environment, status: "PENDING", ...values }).onConflictDoNothing();
      if (operation === "BAJA") summary.cancelled += 1;
      else summary.created += 1;
    }
  }
}

// ── Libro de bienes de inversión ────────────────────────────────────────────────────────────

/** Cuentas de terrenos y edificaciones: regularización en diez años (mismo criterio que el 303). */
const isRealEstateAccount = (code: string | null | undefined) => /^(210|211|220|221)/.test(code ?? "");

/**
 * Apuntes del libro de bienes de inversión de los ejercicios con prorrata definitiva confirmada
 * (desde el año de inicio del suministro). Sin prorrata definitiva no hay libro que suministrar.
 */
async function loadInvestmentGoodDocuments(client: DbClient, profile: SiiCompanyProfile, since: Date, now: Date): Promise<MappedDocument[]> {
  const sinceYear = fiscalCivilDate(since, profile.timezone).year;
  const currentYear = fiscalCivilDate(now, profile.timezone).year;
  const years = Object.keys(profile.vatProrataFinal).map(Number).filter((year) => year >= sinceYear && year <= currentYear).sort();
  if (years.length === 0) return [];

  const rows = await client
    .select({
      lineId: supplierInvoiceLine.id,
      invoiceId: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      issueDate: supplierInvoice.issueDate,
      accountingDate: supplierInvoice.accountingDate,
      description: supplierInvoiceLine.description,
      subtotal: supplierInvoiceLine.subtotalAmount,
      taxAmount: supplierInvoiceLine.taxAmount,
      taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
      prorrataPct: supplierInvoice.prorrataPct,
      vatTreatment: supplierInvoice.vatTreatment,
      supplierName: partner.name,
      supplierTaxId: partner.taxId,
      supplierCountry: partner.countryCode,
      supplierKind: partner.supplierKind,
      accountCode: accountChart.code,
    })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .where(and(
      eq(supplierInvoice.companyId, profile.id),
      notInArray(supplierInvoice.status, ["VOID", "DRAFT"]),
      gte(supplierInvoice.accountingDate, localMidnightInstant(years[0] - 9, 0, 1, profile.timezone)),
      lt(supplierInvoice.accountingDate, localMidnightInstant(years[years.length - 1] + 1, 0, 1, profile.timezone)),
      or(eq(supplierInvoiceLine.isInvestmentGood, true), sql`${accountChart.code} like '2%'`),
    ));
  if (rows.length === 0) return [];

  // Ficha de inmovilizado enlazada a la factura (solo si hay exactamente una: si no, no se sabe a qué línea corresponde).
  const assetsByInvoice = new Map<string, Array<{ code: string; description: string; inServiceDate: string; disposalDate: string | null }>>();
  const invoiceIds = [...new Set(rows.map((row) => row.invoiceId))];
  for (let offset = 0; offset < invoiceIds.length; offset += BATCH) {
    const assets = await client
      .select({ supplierInvoiceId: fixedAsset.supplierInvoiceId, code: fixedAsset.code, description: fixedAsset.description, inServiceDate: fixedAsset.inServiceDate, disposalDate: fixedAsset.disposalDate })
      .from(fixedAsset)
      .where(and(eq(fixedAsset.companyId, profile.id), inArray(fixedAsset.supplierInvoiceId, invoiceIds.slice(offset, offset + BATCH))));
    for (const asset of assets) {
      if (asset.supplierInvoiceId) assetsByInvoice.set(asset.supplierInvoiceId, [...(assetsByInvoice.get(asset.supplierInvoiceId) ?? []), asset]);
    }
  }
  const isoToAeat = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
  const selfAssessmentRate = standardVatRate(profile.countryCode) || 21;

  const goods: SiiInvestmentGoodSource[] = rows.map((row) => {
    const treatment = resolveSupplierVatTreatment(row.vatTreatment, row.supplierCountry, row.supplierKind, profile.countryCode);
    const selfAssessed = treatment === "INTRA_EU" || treatment === "REVERSE_CHARGE";
    const vat = selfAssessed ? reverseChargeTaxAmount(Number(row.subtotal), Number(row.taxAmount), selfAssessmentRate) : Number(row.taxAmount);
    const id = siiPartyId(row.supplierTaxId, row.supplierCountry);
    const issuer: SiiParty | null = id ? { name: row.supplierName, ...id } : null;
    const assets = assetsByInvoice.get(row.invoiceId) ?? [];
    const asset = assets.length === 1 ? assets[0] : null;
    return {
      lineId: row.lineId,
      invoiceId: row.invoiceId,
      number: row.number,
      description: row.description ?? "",
      purchaseYear: fiscalCivilDate(row.accountingDate, profile.timezone).year,
      baseCents: Math.round(Number(row.subtotal) * 100),
      vatCents: Math.round(Number(vat) * 100),
      deductiblePct: Math.min(Math.max(Number(row.taxDeductiblePct ?? 100), 0), 100),
      appliedProrrataPct: Math.min(Math.max(Number(row.prorrataPct ?? 100), 0), 100),
      realEstate: isRealEstateAccount(row.accountCode),
      issuer,
      invoiceNumber: (row.supplierDocumentNumber ?? "").trim() || row.number,
      invoiceIssueDate: formatAeatDate(row.issueDate, profile.timezone),
      accountingDate: formatAeatDate(row.accountingDate, profile.timezone),
      asset: asset ? { code: asset.code, description: asset.description, inServiceDate: isoToAeat(asset.inServiceDate), disposalYear: asset.disposalDate ? Number(asset.disposalDate.slice(0, 4)) : null } : null,
    };
  });

  return years.flatMap((year) => mapInvestmentGoods(goods.filter((good) => good.purchaseYear <= year), { year, finalPct: profile.vatProrataFinal[String(year)], finalByYear: profile.vatProrataFinal })
    .map((mapped): MappedDocument => ({
      sourceId: mapped.sourceId,
      live: true,
      payload: { book: "INVESTMENT_GOODS", good: mapped.good },
      problems: mapped.problems,
      dueDate: investmentGoodsDueDate(year),
    })));
}

/**
 * Desde cuándo aplica la empresa el criterio de caja. El régimen se aplica por años naturales
 * (art. 163 undecies LIVA), así que la primera vez se toma el 1 de enero del año en curso; se puede
 * cambiar en la pantalla del SII. Las operaciones anteriores se suministran con su clave ordinaria.
 */
async function resolveCashAccountingSince(client: DbClient, profile: SiiCompanyProfile, settings: typeof siiSettings.$inferSelect, now: Date) {
  if (profile.fiscalRegime !== "cash_accounting") return null;
  if (settings.cashAccountingSince) return settings.cashAccountingSince;
  const start = localMidnightInstant(fiscalCivilDate(now, profile.timezone).year, 0, 1, profile.timezone);
  await client.update(siiSettings).set({ cashAccountingSince: start, updatedAt: new Date() }).where(eq(siiSettings.companyId, profile.id));
  return start;
}

/** Revisa las facturas de una empresa y deja en la bandeja lo que falta por comunicar. */
export async function detectSiiRecords(companyId: string, options: { client?: DbClient; env?: Record<string, string | undefined>; now?: Date } = {}): Promise<SiiDetectionSummary> {
  const client = options.client ?? db;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const summary: SiiDetectionSummary = { companyId, created: 0, updated: 0, cancelled: 0, discarded: 0, skipped: null };
  const profile = await loadSiiCompanyProfile(client, companyId);
  if (!profile) return { ...summary, skipped: "Empresa no encontrada." };
  const eligibility = siiEligibility(profile);
  if (!eligibility.supported) return { ...summary, skipped: eligibility.reason };
  const environmentConfig = readSiiEnvironment(env);
  if (!environmentConfig.environment) return { ...summary, skipped: environmentConfig.problem };
  const environment = environmentConfig.environment;

  const settings = await ensureSiiSettings(client, profile, now);
  const extraHolidays = parseExtraHolidays(env.SII_EXTRA_HOLIDAYS);
  const loadOptions: LoadOptions = { since: settings.since, extraHolidays, cashAccountingSince: await resolveCashAccountingSince(client, profile, settings, now) };
  const issuedDocuments = await loadIssuedDocuments(client, profile, loadOptions);
  await syncBook(client, companyId, environment, "ISSUED", issuedDocuments, summary);
  const receivedDocuments = await loadReceivedDocuments(client, profile, loadOptions);
  await syncBook(client, companyId, environment, "RECEIVED", receivedDocuments, summary);

  // Cobros y pagos de las facturas con clave 07 (empresa en criterio de caja o proveedores acogidos a él).
  const issuedCash = cashInvoices(issuedDocuments).map((document) => document.sourceId);
  await syncCashBook(client, {
    companyId, environment, book: "ISSUED_COLLECTIONS", parentBook: "ISSUED", timeZone: profile.timezone, extraHolidays,
    liveInvoiceIds: new Set(issuedCash),
    documents: buildCashDocuments(issuedDocuments, issuedCash.length > 0 ? await loadCollections(client, companyId, issuedCash) : new Map(), profile.timezone, now),
  }, summary);
  const receivedCash = cashInvoices(receivedDocuments).map((document) => document.sourceId);
  await syncCashBook(client, {
    companyId, environment, book: "RECEIVED_PAYMENTS", parentBook: "RECEIVED", timeZone: profile.timezone, extraHolidays,
    liveInvoiceIds: new Set(receivedCash),
    documents: buildCashDocuments(receivedDocuments, receivedCash.length > 0 ? await loadSupplierPayments(client, companyId, receivedCash) : new Map(), profile.timezone, now),
  }, summary);

  await syncBook(client, companyId, environment, "INVESTMENT_GOODS", await loadInvestmentGoodDocuments(client, profile, settings.since, now), summary, { discardAbsentPending: true });

  await client.update(siiSettings).set({ lastDetectionAt: now, updatedAt: new Date() }).where(eq(siiSettings.companyId, companyId));
  return summary;
}

/** Empresas con el SII activado. */
export async function listSiiCompanyIds(client: DbClient = db): Promise<string[]> {
  const rows = await client.select({ companyId: companySettings.companyId }).from(companySettings).where(eq(companySettings.siiEnabled, true));
  return rows.map((row) => row.companyId);
}
