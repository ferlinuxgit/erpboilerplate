import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  accountChart,
  bankAccount,
  bankReconciliationRule,
  bankTransaction,
  bankTransactionAllocation,
  company,
  customer,
  fiscalYear,
  invoice,
  item,
  journalEntry,
  journalLine,
  partner,
  payment,
  recurringTemplate,
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  type RecurringTemplateLine,
} from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { ensureJournal, journalCodeForSource } from "@/server/accounting/journals";
import { toCents } from "@/server/accounting/money";
import {
  bankMovementConcept,
  customerPaymentLineDocument,
  invoiceLineDocument,
  reversalConcept,
  supplierInvoiceLineDocument,
  supplierPaymentLineDocument,
  type InvoicePostingContext,
  type LineDocument,
  type SupplierInvoicePostingContext,
} from "@/server/accounting/posting-context";
import {
  effectiveSupplierKind,
  ensurePartnerSubaccount,
  forgetChartMemo,
  loadChartContext,
  primaryPartnerRole,
  toPostableAccountId,
  type PartnerForSubaccount,
} from "@/server/accounting/subaccounts";
import {
  accountGroupCode,
  defaultSupplierKind,
  isCanonicalSubaccountCode,
  isNumericAccountCode,
  nearestAncestorCode,
  type PartnerAccountRole,
  type SupplierKind,
} from "@/server/accounting/subaccounts-model";
import { recordAudit } from "@/server/audit";

/**
 * Reclasificación de la contabilidad existente al plan por subcuentas (fase 1 del rediseño).
 *
 * Es la ÚNICA reescritura autorizada de apuntes: solo cambia la cuenta de los apuntes (y parte en
 * subcuentas de terceros las líneas de clientes/proveedores de los asientos de cierre y apertura),
 * conserva exactamente el debe y el haber, y rellena la información que faltaba (concepto, tercero,
 * documento, vencimiento, orden, ejercicio y diario). No renumera asientos.
 *
 * Garantías (si alguna falla se lanza un error y la transacción se deshace):
 * - las sumas del debe y del haber por cuenta de 3 dígitos son idénticas antes y después;
 * - ningún asiento queda descuadrado;
 * - la numeración sigue siendo única por empresa y ejercicio.
 * Es idempotente: una segunda ejecución no cambia nada.
 */

const PARTY_GROUP_ROLES: Record<string, PartnerAccountRole> = { "430": "customer", "400": "supplier", "410": "supplier" };
const SPLIT_SOURCES = new Set(["fiscalYearClosing", "fiscalYearOpening"]);
const LIFECYCLE_CONCEPTS: Record<string, string> = {
  fiscalYearRegularization: "Regularización ejercicio",
  fiscalYearClosing: "Cierre ejercicio",
  fiscalYearOpening: "Apertura ejercicio",
};

/**
 * Cuenta de control genérica de clientes/proveedores (430, 4300, 430000, 43000000; 400…; 410…):
 * sus apuntes se llevan a la subcuenta del tercero. Devuelve el grupo o null (4309, 4001… no lo son).
 */
export function genericPartyGroup(code: string): string | null {
  const group = code.slice(0, 3);
  if (!PARTY_GROUP_ROLES[group]) return null;
  return /^\d{3}0*$/.test(code) ? group : null;
}

/** Tipo de proveedor por su histórico: mayoría de compras (60x) → mercaderías; si no, servicios. */
export function supplierKindFromHistory(expenseCodes: string[], businessType: string | null | undefined): SupplierKind {
  let goods = 0;
  let other = 0;
  for (const code of expenseCodes) {
    if (code.startsWith("60")) goods += 1;
    else other += 1;
  }
  if (goods === 0 && other === 0) return defaultSupplierKind(businessType);
  if (goods === other) return defaultSupplierKind(businessType);
  return goods > other ? "GOODS" : "SERVICES";
}

/** Palabras de una referencia («Cobro factura FA000049», «Pago a cuenta de proveedor <id>»). */
export function referenceTokens(reference: string | null | undefined) {
  return (reference ?? "").split(/[\s·,;:()"'«»]+/).map((token) => token.trim()).filter(Boolean);
}

type GroupTotals = Map<string, { debitCents: number; creditCents: number }>;

export type ReclassificationReport = {
  companyId: string;
  companyName: string;
  subaccountLength: number;
  applied: boolean;
  accountsCreated: Array<{ code: string; name: string }>;
  accountsMadeGroups: string[];
  supplierKindsAssigned: Array<{ partner: string; kind: SupplierKind; basis: "history" | "businessType" }>;
  partnerAccountsLinked: number;
  linesMoved: { toPartner: number; toGenericParty: number; toCanonical: number };
  lifecycleEntriesSplit: number;
  lifecycleEntriesNotSplit: Array<{ number: string; group: string; reason: string }>;
  unresolvedPartyLines: Array<{ entry: string; account: string; amount: string; sourceType: string | null; reason: string }>;
  unsupportedAccounts: string[];
  linesBackfilled: number;
  referencesRemapped: Record<string, number>;
  entriesWithFiscalYear: number;
  entriesWithoutFiscalYear: number;
  entriesJournalReassigned: number;
  duplicateNumbers: number;
  groupTotals: Array<{ group: string; debitBefore: string; creditBefore: string; debitAfter: string; creditAfter: string }>;
  warnings: string[];
};

const money = (cents: number) => (cents / 100).toFixed(2);

async function loadGroupTotals(tx: DbClient, companyId: string): Promise<GroupTotals> {
  const rows = await tx
    .select({
      group: sql<string>`left(${accountChart.code}, 3)`,
      debit: sql<string>`coalesce(sum(${journalLine.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLine.credit}), 0)`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(eq(journalEntry.companyId, companyId))
    .groupBy(sql`left(${accountChart.code}, 3)`);
  return new Map(rows.map((row) => [row.group, { debitCents: toCents(row.debit), creditCents: toCents(row.credit) }]));
}

async function loadUnbalancedEntries(tx: DbClient, companyId: string) {
  const rows = await tx
    .select({ id: journalLine.journalEntryId })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .where(eq(journalEntry.companyId, companyId))
    .groupBy(journalLine.journalEntryId)
    .having(sql`sum(${journalLine.debit}) <> sum(${journalLine.credit})`);
  return new Set(rows.map((row) => row.id));
}

type AccountRow = { id: string; code: string; name: string; partnerId: string | null; isPostable: boolean; parentCode: string | null };

async function loadAccounts(tx: DbClient, companyId: string) {
  const rows: AccountRow[] = await tx
    .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name, partnerId: accountChart.partnerId, isPostable: accountChart.isPostable, parentCode: accountChart.parentCode })
    .from(accountChart)
    .where(eq(accountChart.companyId, companyId));
  return new Map(rows.map((row) => [row.id, row]));
}

type EntryRow = {
  id: string;
  number: string;
  postedAt: Date;
  reference: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reversesEntryId: string | null;
  isAutomatic: boolean;
};

type LineRow = {
  id: string;
  journalEntryId: string;
  accountId: string;
  debit: string;
  credit: string;
  lineNumber: number | null;
  concept: string | null;
  partnerId: string | null;
  documentType: string | null;
  documentNumber: string | null;
  documentId: string | null;
  dueDate: Date | null;
};

async function loadLines(tx: DbClient, companyId: string): Promise<LineRow[]> {
  return tx
    .select({
      id: journalLine.id,
      journalEntryId: journalLine.journalEntryId,
      accountId: journalLine.accountId,
      debit: journalLine.debit,
      credit: journalLine.credit,
      lineNumber: journalLine.lineNumber,
      concept: journalLine.concept,
      partnerId: journalLine.partnerId,
      documentType: journalLine.documentType,
      documentNumber: journalLine.documentNumber,
      documentId: journalLine.documentId,
      dueDate: journalLine.dueDate,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .where(eq(journalEntry.companyId, companyId))
    .orderBy(asc(journalLine.journalEntryId), asc(journalLine.lineNumber), asc(journalLine.id));
}

/** Documentos de origen de la empresa, precargados una vez (evita una consulta por asiento). */
async function loadSourceDocuments(tx: DbClient, companyId: string) {
  const [invoices, supplierInvoices, payments, supplierPayments, bankMovements, years, partners] = await Promise.all([
    tx
      .select({
        id: invoice.id,
        number: invoice.number,
        invoiceType: invoice.invoiceType,
        rectifiedInvoiceId: invoice.rectifiedInvoiceId,
        dueDate: invoice.dueDate,
        partnerId: customer.partnerId,
        partnerName: partner.name,
        customerName: customer.name,
      })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(eq(invoice.companyId, companyId)),
    tx
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        dueDate: supplierInvoice.dueDate,
        partnerId: supplierInvoice.supplierPartnerId,
        partnerName: partner.name,
      })
      .from(supplierInvoice)
      .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .where(eq(supplierInvoice.companyId, companyId)),
    tx.select({ id: payment.id, number: payment.number, invoiceId: payment.invoiceId }).from(payment).where(eq(payment.companyId, companyId)),
    tx
      .select({ id: supplierPayment.id, number: supplierPayment.number, partnerId: supplierPayment.supplierPartnerId, supplierInvoiceId: supplierPayment.supplierInvoiceId })
      .from(supplierPayment)
      .where(eq(supplierPayment.companyId, companyId)),
    tx
      .select({ id: bankTransaction.id, description: bankTransaction.description, reference: bankTransaction.reference })
      .from(bankTransaction)
      .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
      .where(eq(bankAccount.companyId, companyId)),
    tx.select({ id: fiscalYear.id, code: fiscalYear.code }).from(fiscalYear).where(eq(fiscalYear.companyId, companyId)),
    tx
      .select({ id: partner.id, companyId: partner.companyId, number: partner.number, name: partner.name, type: partner.type, supplierKind: partner.supplierKind, defaultAccountId: partner.defaultAccountId })
      .from(partner)
      .where(eq(partner.companyId, companyId)),
  ]);

  const invoiceNumbers = new Map(invoices.map((row) => [row.id, row.number]));
  const invoiceContexts = new Map<string, InvoicePostingContext>(invoices.map((row) => [row.id, {
    invoiceId: row.id,
    number: row.number,
    invoiceType: row.invoiceType,
    originalNumber: row.rectifiedInvoiceId ? invoiceNumbers.get(row.rectifiedInvoiceId) ?? null : null,
    dueDate: row.dueDate ?? null,
    partnerId: row.partnerId ?? null,
    partyName: row.partnerName ?? row.customerName ?? null,
  }]));
  const supplierInvoiceContexts = new Map<string, SupplierInvoicePostingContext>(supplierInvoices.map((row) => [row.id, {
    supplierInvoiceId: row.id,
    number: row.number,
    documentNumber: row.supplierDocumentNumber?.trim() || row.number,
    dueDate: row.dueDate ?? null,
    partnerId: row.partnerId,
    partyName: row.partnerName ?? null,
  }]));
  const partnersById = new Map<string, PartnerForSubaccount>(partners.map((row) => [row.id, row]));

  // Referencias antiguas sin documento (cobro o pago borrado): se busca un número de factura o el id del proveedor.
  const partnerByToken = new Map<string, string>();
  for (const context of invoiceContexts.values()) if (context.partnerId) partnerByToken.set(context.number, context.partnerId);
  for (const context of supplierInvoiceContexts.values()) {
    partnerByToken.set(context.number, context.partnerId);
    if (context.documentNumber !== context.number) partnerByToken.set(context.documentNumber, context.partnerId);
  }
  for (const row of partners) partnerByToken.set(row.id, row.id);

  return {
    invoiceContexts,
    supplierInvoiceContexts,
    payments: new Map(payments.map((row) => [row.id, row])),
    supplierPayments: new Map(supplierPayments.map((row) => [row.id, row])),
    bankMovements: new Map(bankMovements.map((row) => [row.id, row])),
    years: new Map(years.map((row) => [row.id, row.code])),
    partnersById,
    partnerByToken,
  };
}

type SourceDocuments = Awaited<ReturnType<typeof loadSourceDocuments>>;

/** Tercero y documento de un asiento a partir de su origen (función pura sobre los documentos precargados). */
function describeEntry(entry: EntryRow, documents: SourceDocuments): { partnerId: string | null; document: LineDocument | null; via: string | null } {
  const sourceId = entry.sourceId ?? "";
  switch (entry.sourceType) {
    case "invoice": {
      const context = documents.invoiceContexts.get(sourceId);
      if (context) return { partnerId: context.partnerId, document: invoiceLineDocument(context), via: context.partnerId ? "invoice" : null };
      break;
    }
    case "supplierInvoice": {
      const context = documents.supplierInvoiceContexts.get(sourceId);
      if (context) return { partnerId: context.partnerId, document: supplierInvoiceLineDocument(context), via: "supplierInvoice" };
      break;
    }
    case "payment": {
      const row = documents.payments.get(sourceId);
      const context = row ? documents.invoiceContexts.get(row.invoiceId) : undefined;
      if (row && context) {
        return {
          partnerId: context.partnerId,
          document: customerPaymentLineDocument({ ...context, paymentId: row.id, paymentNumber: row.number }),
          via: context.partnerId ? "payment" : null,
        };
      }
      break;
    }
    case "supplierPayment": {
      const row = documents.supplierPayments.get(sourceId);
      if (row) {
        const partnerRow = documents.partnersById.get(row.partnerId);
        return {
          partnerId: row.partnerId,
          document: supplierPaymentLineDocument({
            supplierPaymentId: row.id,
            paymentNumber: row.number,
            partnerId: row.partnerId,
            partyName: partnerRow?.name ?? null,
            invoice: row.supplierInvoiceId ? documents.supplierInvoiceContexts.get(row.supplierInvoiceId) ?? null : null,
          }),
          via: "supplierPayment",
        };
      }
      break;
    }
    case "bankTransaction":
    case "bankTransactionAssignment": {
      const row = documents.bankMovements.get(sourceId);
      if (row) {
        return {
          partnerId: null,
          document: {
            concept: entry.sourceType === "bankTransactionAssignment" && entry.reference ? entry.reference.slice(0, 200) : bankMovementConcept(row.description),
            partnerId: null,
            documentType: "bankTransaction",
            documentNumber: row.reference?.trim() || null,
            documentId: row.id,
            dueDate: null,
          },
          via: null,
        };
      }
      break;
    }
    case "fiscalYearRegularization":
    case "fiscalYearClosing":
    case "fiscalYearOpening": {
      const code = documents.years.get(sourceId) ?? null;
      return {
        partnerId: null,
        document: {
          concept: code ? `${LIFECYCLE_CONCEPTS[entry.sourceType]} ${code}` : entry.reference ?? LIFECYCLE_CONCEPTS[entry.sourceType],
          partnerId: null,
          documentType: "fiscalYear",
          documentNumber: code,
          documentId: sourceId || null,
          dueDate: null,
        },
        via: null,
      };
    }
    default:
      break;
  }
  // Documento borrado o asiento manual: el tercero se busca en la referencia.
  const token = referenceTokens(entry.reference).find((candidate) => documents.partnerByToken.has(candidate));
  const partnerId = token ? documents.partnerByToken.get(token) ?? null : null;
  return {
    partnerId,
    document: entry.reference ? { concept: entry.reference.slice(0, 200), partnerId, documentType: null, documentNumber: null, documentId: null, dueDate: null } : null,
    via: partnerId ? "reference" : null,
  };
}

async function assignSupplierKinds(tx: DbClient, companyId: string, businessType: string, documents: SourceDocuments, report: ReclassificationReport) {
  const suppliers = [...documents.partnersById.values()].filter((row) => row.type !== "CUSTOMER" && !row.supplierKind);
  if (suppliers.length === 0) return;
  const history = await tx
    .select({ partnerId: supplierInvoice.supplierPartnerId, code: accountChart.code })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoiceLine.supplierInvoiceId))
    .innerJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .where(and(eq(supplierInvoice.companyId, companyId), inArray(supplierInvoice.supplierPartnerId, suppliers.map((row) => row.id))));
  const codesByPartner = new Map<string, string[]>();
  for (const row of history) codesByPartner.set(row.partnerId, [...(codesByPartner.get(row.partnerId) ?? []), row.code]);
  for (const supplierRow of suppliers) {
    const codes = codesByPartner.get(supplierRow.id) ?? [];
    const kind = supplierKindFromHistory(codes, businessType);
    await tx.update(partner).set({ supplierKind: kind, updatedAt: new Date() }).where(and(eq(partner.companyId, companyId), eq(partner.id, supplierRow.id)));
    supplierRow.supplierKind = kind;
    report.supplierKindsAssigned.push({ partner: supplierRow.name, kind, basis: codes.length > 0 ? "history" : "businessType" });
  }
}

async function updateLineAccounts(tx: DbClient, moves: Map<string, string[]>) {
  for (const [accountId, lineIds] of moves) {
    for (let index = 0; index < lineIds.length; index += 500) {
      await tx.update(journalLine).set({ accountId }).where(inArray(journalLine.id, lineIds.slice(index, index + 500)));
    }
  }
}

/**
 * Reparte en subcuentas de terceros las líneas de clientes/proveedores de un asiento de cierre o
 * apertura (o de su anulación), según los saldos de cada subcuenta a la fecha del asiento. Solo si
 * cuadra exactamente con el saldo del grupo; si no, se deja como está y se informa.
 */
async function splitLifecycleEntry(
  tx: DbClient,
  entry: EntryRow,
  group: string,
  context: { accounts: Map<string, AccountRow>; lines: LineRow[]; entriesById: Map<string, EntryRow>; concept: string; documentId: string | null; documentNumber: string | null },
): Promise<"split" | "unchanged" | string> {
  const inGroup = (line: LineRow) => (context.accounts.get(line.accountId)?.code ?? "").startsWith(group);
  const entryLines = context.lines.filter((line) => line.journalEntryId === entry.id && inGroup(line));
  if (!entryLines.some((line) => !context.accounts.get(line.accountId)?.partnerId)) return "unchanged";
  const entryNet = entryLines.reduce((sum, line) => sum + toCents(line.debit) - toCents(line.credit), 0);

  const balances = new Map<string, number>();
  for (const line of context.lines) {
    const owner = context.entriesById.get(line.journalEntryId);
    if (!owner || owner.postedAt >= entry.postedAt || (owner.sourceType && SPLIT_SOURCES.has(owner.sourceType)) || !inGroup(line)) continue;
    balances.set(line.accountId, (balances.get(line.accountId) ?? 0) + toCents(line.debit) - toCents(line.credit));
  }
  const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) return entryNet === 0 ? "unchanged" : `el grupo no tiene saldo a la fecha del asiento (importe ${money(entryNet)})`;
  const sign = entryNet === -total ? -1 : entryNet === total ? 1 : 0;
  if (sign === 0) return `el importe del asiento (${money(entryNet)}) no coincide con el saldo del grupo (${money(total)})`;

  const targets = [...balances.entries()].filter(([, cents]) => cents !== 0).map(([accountId, cents]) => ({ accountId, cents: sign * cents }));
  const current = entryLines.map((line) => ({ accountId: line.accountId, cents: toCents(line.debit) - toCents(line.credit) }));
  const key = (rows: Array<{ accountId: string; cents: number }>) => rows.map((row) => `${row.accountId}:${row.cents}`).sort().join("|");
  if (key(targets) === key(current)) return "unchanged";

  // Las líneas nuevas quedan sin número de orden: el paso de completado renumera todo el asiento.
  await tx.delete(journalLine).where(inArray(journalLine.id, entryLines.map((line) => line.id)));
  await tx.update(journalLine).set({ lineNumber: null }).where(eq(journalLine.journalEntryId, entry.id));
  await tx.insert(journalLine).values(targets
    .sort((a, b) => (context.accounts.get(a.accountId)?.code ?? "").localeCompare(context.accounts.get(b.accountId)?.code ?? ""))
    .map((target) => ({
      journalEntryId: entry.id,
      accountId: target.accountId,
      debit: target.cents > 0 ? money(target.cents) : "0.00",
      credit: target.cents < 0 ? money(-target.cents) : "0.00",
      concept: context.concept || null,
      partnerId: context.accounts.get(target.accountId)?.partnerId ?? null,
      documentType: "fiscalYear",
      documentNumber: context.documentNumber,
      documentId: context.documentId,
    })));
  return "split";
}

/**
 * Reclasifica una empresa dentro de la transacción recibida. Con `apply: false` hace exactamente
 * lo mismo y quien llama deshace la transacción (ensayo fiel).
 */
export async function reclassifyCompany(tx: DbClient, companyId: string, options: { apply: boolean; actorUserId?: string | null }): Promise<ReclassificationReport> {
  forgetChartMemo(tx);
  const [companyRow] = await tx.select({ id: company.id, name: company.name, tenantId: company.tenantId }).from(company).where(eq(company.id, companyId)).limit(1);
  if (!companyRow) throw new Error(`Empresa ${companyId} no encontrada.`);
  const chart = await loadChartContext(companyId, tx);
  const length = chart.subaccountLength;
  const report: ReclassificationReport = {
    companyId,
    companyName: companyRow.name,
    subaccountLength: length,
    applied: options.apply,
    accountsCreated: [],
    accountsMadeGroups: [],
    supplierKindsAssigned: [],
    partnerAccountsLinked: 0,
    linesMoved: { toPartner: 0, toGenericParty: 0, toCanonical: 0 },
    lifecycleEntriesSplit: 0,
    lifecycleEntriesNotSplit: [],
    unresolvedPartyLines: [],
    unsupportedAccounts: [],
    linesBackfilled: 0,
    referencesRemapped: {},
    entriesWithFiscalYear: 0,
    entriesWithoutFiscalYear: 0,
    entriesJournalReassigned: 0,
    duplicateNumbers: 0,
    groupTotals: [],
    warnings: [],
  };

  const totalsBefore = await loadGroupTotals(tx, companyId);
  const unbalancedBefore = await loadUnbalancedEntries(tx, companyId);
  const accountsBefore = await loadAccounts(tx, companyId);
  const codesBefore = new Set([...accountsBefore.values()].map((row) => row.code));
  const documents = await loadSourceDocuments(tx, companyId);

  // a) Tipo de proveedor y subcuenta de cada tercero (defaultAccountId).
  await assignSupplierKinds(tx, companyId, chart.businessType, documents, report);
  for (const partnerRow of documents.partnersById.values()) {
    const roles: PartnerAccountRole[] = partnerRow.type === "BOTH" ? ["supplier", "customer"] : [primaryPartnerRole(partnerRow.type)];
    for (const role of roles) {
      const account = await ensurePartnerSubaccount(partnerRow, { role, client: tx });
      if (role === primaryPartnerRole(partnerRow.type) && partnerRow.defaultAccountId !== account.id) {
        partnerRow.defaultAccountId = account.id;
        report.partnerAccountsLinked += 1;
      }
    }
  }

  // b) y c) Cuenta de cada apunte.
  const entries: EntryRow[] = await tx
    .select({
      id: journalEntry.id,
      number: journalEntry.number,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
      sourceType: journalEntry.sourceType,
      sourceId: journalEntry.sourceId,
      reversesEntryId: journalEntry.reversesEntryId,
      isAutomatic: journalEntry.isAutomatic,
    })
    .from(journalEntry)
    .where(eq(journalEntry.companyId, companyId))
    .orderBy(asc(journalEntry.postedAt), asc(journalEntry.number));
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const described = new Map<string, ReturnType<typeof describeEntry>>();
  const describe = (entry: EntryRow): ReturnType<typeof describeEntry> => {
    const cached = described.get(entry.id);
    if (cached) return cached;
    let result = describeEntry(entry, documents);
    const original = entry.reversesEntryId ? entriesById.get(entry.reversesEntryId) : undefined;
    if (original) {
      // Anulación: mismo tercero y documento que el asiento anulado.
      const base = describe(original);
      const partnerId = result.partnerId ?? base.partnerId;
      const document = base.document ?? result.document;
      result = {
        partnerId,
        document: document ? { ...document, partnerId, concept: reversalConcept(document.concept, entry.reference ?? "") } : null,
        via: result.via ?? (base.via ? "reversal" : null),
      };
    }
    described.set(entry.id, result);
    return result;
  };

  let accounts = await loadAccounts(tx, companyId);
  let lines = await loadLines(tx, companyId);
  const moves = new Map<string, string[]>();
  const move = (lineId: string, accountId: string) => moves.set(accountId, [...(moves.get(accountId) ?? []), lineId]);
  for (const line of lines) {
    const account = accounts.get(line.accountId);
    const entry = entriesById.get(line.journalEntryId);
    if (!account || !entry) continue;
    if (!isNumericAccountCode(account.code)) {
      if (!report.unsupportedAccounts.includes(account.code)) report.unsupportedAccounts.push(account.code);
      continue;
    }
    const group = !account.partnerId ? genericPartyGroup(account.code) : null;
    const isSplitEntry = Boolean(entry.sourceType && SPLIT_SOURCES.has(entry.sourceType));
    if (group && !isSplitEntry) {
      const { partnerId } = describe(entry);
      const partnerRow = partnerId ? documents.partnersById.get(partnerId) : undefined;
      if (partnerRow) {
        const target = await ensurePartnerSubaccount(partnerRow, { role: PARTY_GROUP_ROLES[group], prefix: group, client: tx });
        if (target.id !== line.accountId) {
          move(line.id, target.id);
          report.linesMoved.toPartner += 1;
        }
        continue;
      }
      const target = await toPostableAccountId(companyId, line.accountId, tx);
      if (target !== line.accountId) {
        move(line.id, target);
        report.linesMoved.toGenericParty += 1;
      }
      report.unresolvedPartyLines.push({
        entry: entry.number,
        account: account.code,
        amount: money(toCents(line.debit) - toCents(line.credit)),
        sourceType: entry.sourceType,
        reason: entry.sourceId ? "documento de origen sin tercero o borrado" : "asiento sin documento de origen",
      });
      continue;
    }
    if (account.code.length > length) {
      if (!report.unsupportedAccounts.includes(account.code)) report.unsupportedAccounts.push(account.code);
      continue;
    }
    if (!isCanonicalSubaccountCode(account.code, length)) {
      const target = await toPostableAccountId(companyId, line.accountId, tx);
      if (target !== line.accountId) {
        move(line.id, target);
        report.linesMoved.toCanonical += 1;
      }
    }
  }
  await updateLineAccounts(tx, moves);

  // Cierre y apertura: la línea de clientes/proveedores se reparte por subcuenta de tercero.
  accounts = await loadAccounts(tx, companyId);
  lines = await loadLines(tx, companyId);
  for (const entry of entries) {
    const lifecycleSource = entry.sourceType && SPLIT_SOURCES.has(entry.sourceType);
    if (!lifecycleSource) continue;
    const groups = new Set(lines
      .filter((line) => line.journalEntryId === entry.id)
      .map((line) => accountGroupCode(accounts.get(line.accountId)?.code ?? ""))
      .filter((group) => PARTY_GROUP_ROLES[group]));
    const description = describe(entry);
    for (const group of groups) {
      const outcome = await splitLifecycleEntry(tx, entry, group, {
        accounts,
        lines,
        entriesById,
        concept: description.document?.concept ?? entry.reference ?? "",
        documentId: description.document?.documentId ?? null,
        documentNumber: description.document?.documentNumber ?? null,
      });
      if (outcome === "split") {
        report.lifecycleEntriesSplit += 1;
        lines = await loadLines(tx, companyId);
      } else if (outcome !== "unchanged") {
        report.lifecycleEntriesNotSplit.push({ number: entry.number, group, reason: outcome });
      }
    }
  }
  // Las líneas de cierre/apertura que no se pudieron repartir van, al menos, a su subcuenta canónica.
  const lifecycleMoves = new Map<string, string[]>();
  for (const line of lines) {
    const account = accounts.get(line.accountId);
    if (!account || !isNumericAccountCode(account.code) || account.code.length >= length) continue;
    const target = await toPostableAccountId(companyId, line.accountId, tx);
    if (target !== line.accountId) {
      lifecycleMoves.set(target, [...(lifecycleMoves.get(target) ?? []), line.id]);
      report.linesMoved.toCanonical += 1;
    }
  }
  await updateLineAccounts(tx, lifecycleMoves);

  // Cuentas antiguas (1–7 dígitos): quedan como cuentas de grupo, sin apuntes nuevos.
  const madeGroups = await tx
    .update(accountChart)
    .set({ isPostable: false })
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, true), sql`length(${accountChart.code}) < ${length}`))
    .returning({ code: accountChart.code });
  report.accountsMadeGroups = madeGroups.map((row) => row.code).sort();

  // Enlace con la cuenta padre de las subcuentas que no lo tenían.
  accounts = await loadAccounts(tx, companyId);
  const allCodes = [...accounts.values()].map((row) => row.code);
  for (const account of accounts.values()) {
    if (account.parentCode || account.code.length < 2) continue;
    const parentCode = nearestAncestorCode(account.code, allCodes);
    if (parentCode) await tx.update(accountChart).set({ parentCode }).where(eq(accountChart.id, account.id));
  }

  // Referencias de documentos y fichas a cuentas antiguas → su subcuenta.
  const remap = async (accountId: string | null) => {
    if (!accountId) return null;
    const account = accounts.get(accountId);
    if (!account || !isNumericAccountCode(account.code) || account.code.length >= length) return null;
    const target = await toPostableAccountId(companyId, accountId, tx);
    return target !== accountId ? target : null;
  };
  const counters: Record<string, number> = {};
  const bump = (key: string) => {
    counters[key] = (counters[key] ?? 0) + 1;
  };
  for (const row of await tx.select({ id: bankAccount.id, accountId: bankAccount.accountId }).from(bankAccount).where(eq(bankAccount.companyId, companyId))) {
    const target = await remap(row.accountId);
    if (target) {
      await tx.update(bankAccount).set({ accountId: target }).where(eq(bankAccount.id, row.id));
      bump("bankAccount");
    }
  }
  for (const row of await tx.select({ id: partner.id, accountId: partner.defaultExpenseAccountId }).from(partner).where(eq(partner.companyId, companyId))) {
    const target = await remap(row.accountId);
    if (target) {
      await tx.update(partner).set({ defaultExpenseAccountId: target }).where(eq(partner.id, row.id));
      bump("partner.defaultExpenseAccountId");
    }
  }
  for (const row of await tx.select({ id: item.id, salesAccountId: item.salesAccountId, purchaseAccountId: item.purchaseAccountId }).from(item).where(eq(item.companyId, companyId))) {
    const sales = await remap(row.salesAccountId);
    const purchase = await remap(row.purchaseAccountId);
    if (sales || purchase) {
      await tx.update(item).set({ ...(sales ? { salesAccountId: sales } : {}), ...(purchase ? { purchaseAccountId: purchase } : {}) }).where(eq(item.id, row.id));
      bump("item");
    }
  }
  for (const row of await tx.select({ id: bankReconciliationRule.id, accountId: bankReconciliationRule.accountId }).from(bankReconciliationRule).where(eq(bankReconciliationRule.companyId, companyId))) {
    const target = await remap(row.accountId);
    if (target) {
      await tx.update(bankReconciliationRule).set({ accountId: target }).where(eq(bankReconciliationRule.id, row.id));
      bump("bankReconciliationRule");
    }
  }
  for (const row of await tx.select({ id: bankTransactionAllocation.id, accountId: bankTransactionAllocation.accountId }).from(bankTransactionAllocation).where(eq(bankTransactionAllocation.companyId, companyId))) {
    const target = await remap(row.accountId);
    if (target) {
      await tx.update(bankTransactionAllocation).set({ accountId: target }).where(eq(bankTransactionAllocation.id, row.id));
      bump("bankTransactionAllocation");
    }
  }
  const expenseLines = await tx
    .select({ id: supplierInvoiceLine.id, accountId: supplierInvoiceLine.expenseAccountId })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoiceLine.supplierInvoiceId))
    .where(eq(supplierInvoice.companyId, companyId));
  for (const row of expenseLines) {
    const target = await remap(row.accountId);
    if (target) {
      await tx.update(supplierInvoiceLine).set({ expenseAccountId: target }).where(eq(supplierInvoiceLine.id, row.id));
      bump("supplierInvoiceLine");
    }
  }
  for (const row of await tx.select({ id: recurringTemplate.id, lines: recurringTemplate.lines }).from(recurringTemplate).where(eq(recurringTemplate.companyId, companyId))) {
    let changed = false;
    const nextLines: RecurringTemplateLine[] = [];
    for (const templateLine of row.lines ?? []) {
      const target = await remap(templateLine.expenseAccountId ?? null);
      if (target) changed = true;
      nextLines.push(target ? { ...templateLine, expenseAccountId: target } : templateLine);
    }
    if (changed) {
      await tx.update(recurringTemplate).set({ lines: nextLines }).where(eq(recurringTemplate.id, row.id));
      bump("recurringTemplate");
    }
  }
  report.referencesRemapped = counters;

  // d) Concepto, tercero, documento, vencimiento y orden de los apuntes antiguos (solo lo que falta).
  accounts = await loadAccounts(tx, companyId);
  lines = await loadLines(tx, companyId);
  const linesByEntry = new Map<string, LineRow[]>();
  for (const line of lines) linesByEntry.set(line.journalEntryId, [...(linesByEntry.get(line.journalEntryId) ?? []), line]);
  for (const entry of entries) {
    const entryLines = linesByEntry.get(entry.id) ?? [];
    const { document, partnerId } = describe(entry);
    const ordered = [...entryLines].sort((a, b) => {
      if (a.lineNumber !== null && b.lineNumber !== null) return a.lineNumber - b.lineNumber;
      const side = (line: LineRow) => (toCents(line.debit) > 0 ? 0 : 1);
      return side(a) - side(b) || (accounts.get(a.accountId)?.code ?? "").localeCompare(accounts.get(b.accountId)?.code ?? "") || a.id.localeCompare(b.id);
    });
    const needsNumbers = ordered.some((line) => line.lineNumber === null);
    for (const [index, line] of ordered.entries()) {
      const account = accounts.get(line.accountId);
      const isParty = Boolean(account && PARTY_GROUP_ROLES[accountGroupCode(account.code)]);
      const changes: Partial<typeof journalLine.$inferInsert> = {};
      if (needsNumbers && line.lineNumber !== index + 1) changes.lineNumber = index + 1;
      const concept = document?.concept ?? entry.reference?.slice(0, 200) ?? null;
      if (!line.concept && concept) changes.concept = concept;
      const linePartner = account?.partnerId ?? partnerId ?? document?.partnerId ?? null;
      if (!line.partnerId && linePartner) changes.partnerId = linePartner;
      if (document) {
        if (!line.documentType && document.documentType) changes.documentType = document.documentType;
        if (!line.documentNumber && document.documentNumber) changes.documentNumber = document.documentNumber;
        if (!line.documentId && document.documentId) changes.documentId = document.documentId;
        if (!line.dueDate && isParty && document.dueDate) changes.dueDate = document.dueDate;
      }
      if (Object.keys(changes).length > 0) {
        await tx.update(journalLine).set(changes).where(eq(journalLine.id, line.id));
        report.linesBackfilled += 1;
      }
    }
  }

  // e) Ejercicio de cada asiento (por fecha; no se renumera) y diario según su origen.
  await tx
    .update(journalEntry)
    .set({
      fiscalYearId: sql`(
        select fy."id" from "fiscal_year" fy
        where fy."companyId" = ${companyId}
          and "journal_entry"."postedAt" >= fy."startsAt"
          and "journal_entry"."postedAt" < (fy."endsAt" + interval '1 day')
        order by fy."startsAt" desc
        limit 1
      )`,
    })
    .where(and(eq(journalEntry.companyId, companyId), isNull(journalEntry.fiscalYearId)));
  const [yearCounts] = await tx
    .select({
      withYear: sql<number>`count(*) filter (where ${journalEntry.fiscalYearId} is not null)`.mapWith(Number),
      withoutYear: sql<number>`count(*) filter (where ${journalEntry.fiscalYearId} is null)`.mapWith(Number),
    })
    .from(journalEntry)
    .where(eq(journalEntry.companyId, companyId));
  report.entriesWithFiscalYear = yearCounts?.withYear ?? 0;
  report.entriesWithoutFiscalYear = yearCounts?.withoutYear ?? 0;
  const duplicates = await tx
    .select({ number: journalEntry.number })
    .from(journalEntry)
    .where(eq(journalEntry.companyId, companyId))
    .groupBy(journalEntry.fiscalYearId, journalEntry.number)
    .having(sql`count(*) > 1`);
  report.duplicateNumbers = duplicates.length;
  if (duplicates.length > 0) throw new Error(`Números de asiento duplicados en un ejercicio: ${duplicates.map((row) => row.number).join(", ")}.`);

  const sources = [...new Set(entries.map((entry) => entry.sourceType ?? null))];
  for (const sourceType of sources) {
    const target = await ensureJournal(companyId, journalCodeForSource(sourceType), tx);
    const updated = await tx
      .update(journalEntry)
      .set({ journalId: target.id })
      .where(and(
        eq(journalEntry.companyId, companyId),
        sourceType === null ? isNull(journalEntry.sourceType) : eq(journalEntry.sourceType, sourceType),
        sql`${journalEntry.journalId} <> ${target.id}`,
      ))
      .returning({ id: journalEntry.id });
    report.entriesJournalReassigned += updated.length;
  }

  // f) Invariantes: sumas por cuenta de 3 dígitos idénticas y ningún asiento nuevo descuadrado.
  const totalsAfter = await loadGroupTotals(tx, companyId);
  const groups = [...new Set([...totalsBefore.keys(), ...totalsAfter.keys()])].sort();
  const changedGroups: string[] = [];
  for (const group of groups) {
    const before = totalsBefore.get(group) ?? { debitCents: 0, creditCents: 0 };
    const after = totalsAfter.get(group) ?? { debitCents: 0, creditCents: 0 };
    report.groupTotals.push({ group, debitBefore: money(before.debitCents), creditBefore: money(before.creditCents), debitAfter: money(after.debitCents), creditAfter: money(after.creditCents) });
    if (before.debitCents !== after.debitCents || before.creditCents !== after.creditCents) changedGroups.push(group);
  }
  if (changedGroups.length > 0) {
    throw new ReclassificationInvariantError(`Las sumas por cuenta de 3 dígitos han cambiado (${changedGroups.join(", ")}): se deshace la reclasificación.`, report);
  }
  const unbalancedAfter = await loadUnbalancedEntries(tx, companyId);
  const newlyUnbalanced = [...unbalancedAfter].filter((id) => !unbalancedBefore.has(id));
  if (newlyUnbalanced.length > 0) {
    throw new ReclassificationInvariantError(`Hay asientos descuadrados tras la reclasificación (${newlyUnbalanced.length}): se deshace.`, report);
  }
  if (unbalancedBefore.size > 0) report.warnings.push(`${unbalancedBefore.size} asientos ya estaban descuadrados antes de reclasificar (no se han tocado sus importes).`);
  const kindMismatch = [...documents.partnersById.values()].filter((row) => row.type !== "CUSTOMER" && effectiveSupplierKind(row.supplierKind, chart.businessType) === "GOODS");
  if (kindMismatch.length > 0 && report.linesMoved.toPartner > 0) {
    report.warnings.push("Los apuntes antiguos de proveedores se mantienen en su grupo (400 o 410) para no alterar las sumas por grupo; si un proveedor de mercaderías tiene saldo histórico en 410, reclasifícalo con un asiento manual 410 → 400.");
  }

  const accountsAfter = await loadAccounts(tx, companyId);
  report.accountsCreated = [...accountsAfter.values()]
    .filter((row) => !codesBefore.has(row.code))
    .map((row) => ({ code: row.code, name: row.name }))
    .sort((a, b) => a.code.localeCompare(b.code));

  if (options.apply) {
    await recordAudit({
      tenantId: companyRow.tenantId,
      companyId,
      actorUserId: options.actorUserId ?? undefined,
      action: "accounting.reclassify",
      entityName: "company",
      entityId: companyId,
      payload: {
        subaccountLength: length,
        accountsCreated: report.accountsCreated.length,
        accountsMadeGroups: report.accountsMadeGroups.length,
        supplierKindsAssigned: report.supplierKindsAssigned.length,
        partnerAccountsLinked: report.partnerAccountsLinked,
        linesMoved: report.linesMoved,
        lifecycleEntriesSplit: report.lifecycleEntriesSplit,
        unresolvedPartyLines: report.unresolvedPartyLines.length,
        linesBackfilled: report.linesBackfilled,
        referencesRemapped: report.referencesRemapped,
        entriesWithFiscalYear: report.entriesWithFiscalYear,
        entriesJournalReassigned: report.entriesJournalReassigned,
      },
    }, tx);
  }
  forgetChartMemo(tx);
  return report;
}

export class ReclassificationInvariantError extends Error {
  readonly report: ReclassificationReport;

  constructor(message: string, report: ReclassificationReport) {
    super(message);
    this.name = "ReclassificationInvariantError";
    this.report = report;
  }
}

/** Señal interna para deshacer la transacción del ensayo (dry-run) conservando el informe. */
class DryRunRollback extends Error {
  readonly report: ReclassificationReport;

  constructor(report: ReclassificationReport) {
    super("dry-run");
    this.report = report;
  }
}

type TransactionalDb = { transaction: <T>(work: (tx: DbClient) => Promise<T>) => Promise<T> };

/**
 * Reclasifica cada empresa en su propia transacción. En ensayo (por defecto) todo se ejecuta y se
 * deshace al final, así el informe es exactamente lo que haría `apply`.
 */
export async function runReclassification(database: TransactionalDb, options: { apply: boolean; companyIds: string[]; actorUserId?: string | null }) {
  const reports: ReclassificationReport[] = [];
  for (const companyId of options.companyIds) {
    try {
      const report = await database.transaction(async (tx) => {
        const result = await reclassifyCompany(tx, companyId, { apply: options.apply, actorUserId: options.actorUserId });
        if (!options.apply) throw new DryRunRollback(result);
        return result;
      });
      reports.push(report);
    } catch (error) {
      if (error instanceof DryRunRollback) {
        reports.push(error.report);
        continue;
      }
      throw error;
    }
  }
  return reports;
}

/** Informe legible (texto plano) de la reclasificación de una empresa. */
export function formatReclassificationReport(report: ReclassificationReport) {
  const lines: string[] = [];
  lines.push(`== ${report.companyName} (${report.companyId}) · subcuentas de ${report.subaccountLength} dígitos · ${report.applied ? "APLICADO" : "ENSAYO (sin cambios)"}`);
  lines.push(`Cuentas creadas: ${report.accountsCreated.length}`);
  for (const account of report.accountsCreated.slice(0, 200)) lines.push(`  + ${account.code} ${account.name}`);
  if (report.accountsCreated.length > 200) lines.push(`  … y ${report.accountsCreated.length - 200} más`);
  lines.push(`Cuentas antiguas convertidas en cuentas de grupo (sin apuntes nuevos): ${report.accountsMadeGroups.length}${report.accountsMadeGroups.length ? ` (${report.accountsMadeGroups.slice(0, 40).join(", ")}${report.accountsMadeGroups.length > 40 ? "…" : ""})` : ""}`);
  lines.push(`Tipo de proveedor asignado: ${report.supplierKindsAssigned.length}`);
  for (const entry of report.supplierKindsAssigned) lines.push(`  · ${entry.partner}: ${entry.kind === "GOODS" ? "mercaderías (400)" : "servicios (410)"} por ${entry.basis === "history" ? "histórico de gastos" : "tipo de negocio"}`);
  lines.push(`Terceros enlazados con su subcuenta: ${report.partnerAccountsLinked}`);
  lines.push(`Apuntes movidos → subcuenta del tercero: ${report.linesMoved.toPartner}`);
  lines.push(`Apuntes de clientes/proveedores sin tercero → subcuenta genérica: ${report.linesMoved.toGenericParty}`);
  lines.push(`Apuntes movidos → subcuenta canónica: ${report.linesMoved.toCanonical}`);
  lines.push(`Asientos de cierre/apertura repartidos por tercero: ${report.lifecycleEntriesSplit}`);
  for (const entry of report.lifecycleEntriesNotSplit) lines.push(`  ! ${entry.number} (${entry.group}): ${entry.reason}`);
  lines.push(`Apuntes de clientes/proveedores sin tercero identificado: ${report.unresolvedPartyLines.length}`);
  for (const line of report.unresolvedPartyLines.slice(0, 100)) lines.push(`  ? ${line.entry} · ${line.account} · ${line.amount} · ${line.sourceType ?? "manual"} · ${line.reason}`);
  if (report.unsupportedAccounts.length) lines.push(`Cuentas no convertibles (código no numérico o más largo que la subcuenta): ${report.unsupportedAccounts.join(", ")}`);
  lines.push(`Apuntes completados (concepto, tercero, documento, vencimiento, orden): ${report.linesBackfilled}`);
  lines.push(`Referencias a cuentas antiguas actualizadas: ${Object.entries(report.referencesRemapped).map(([key, value]) => `${key}=${value}`).join(", ") || "ninguna"}`);
  lines.push(`Asientos con ejercicio: ${report.entriesWithFiscalYear} · sin ejercicio: ${report.entriesWithoutFiscalYear} · con diario reasignado: ${report.entriesJournalReassigned} · números duplicados: ${report.duplicateNumbers}`);
  lines.push("Sumas por cuenta de 3 dígitos (antes → después):");
  for (const group of report.groupTotals) {
    const same = group.debitBefore === group.debitAfter && group.creditBefore === group.creditAfter;
    lines.push(`  ${group.group}  D ${group.debitBefore} → ${group.debitAfter}  H ${group.creditBefore} → ${group.creditAfter}  ${same ? "OK" : "DIFERENTE"}`);
  }
  for (const warning of report.warnings) lines.push(`Aviso: ${warning}`);
  return lines.join("\n");
}
