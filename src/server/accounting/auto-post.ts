import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { accountChart, bankAccount, company, companySettings, item, journalEntry, journalLine, partner, paymentMethod, supplierInvoice } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCompanyTemplate } from "@/lib/company-templates";
import {
  isSelfAssessedTreatment,
  resolveSupplierVatTreatment,
  reverseChargeTaxAmount,
  type SupplierVatTreatment,
} from "@/lib/fiscal-spain";
import { AccountingRuleError } from "@/server/accounting/errors";
import { ensureJournal, journalCodeForSource } from "@/server/accounting/journals";
import { applyPct, centsToAmount, sumCents, toCents } from "@/server/accounting/money";
import { reserveJournalEntryNumber } from "@/server/accounting/numbers";
import {
  customerPaymentLineDocument,
  invoiceLineDocument,
  loadBankTransactionLineDocument,
  loadCustomerPaymentPostingContext,
  loadInvoicePostingContext,
  loadSupplierInvoicePostingContext,
  loadSupplierPaymentPostingContext,
  reversalConcept,
  supplierInvoiceLineDocument,
  supplierPaymentLineDocument,
  type LineDocument,
} from "@/server/accounting/posting-context";
import { ensurePartnerSubaccount, ensureSubaccount, loadChartContext, toPostableAccountId } from "@/server/accounting/subaccounts";
import { isCanonicalSubaccountCode, type PartnerAccountRole } from "@/server/accounting/subaccounts-model";
import { recordAudit } from "@/server/audit";

type PostingInput = {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  postedAt: Date;
  reference: string;
  dbClient?: DbClient;
};

export type AccountRole =
  | "customer"
  | "supplier"
  | "sales"
  | "purchase"
  | "bank"
  | "vatOutput"
  | "vatInput"
  /** Retenciones practicadas por la empresa a profesionales/arrendadores (pasivo, 4751). */
  | "withholdingPayable"
  /** Retenciones que nos practican los clientes (activo, 473). */
  | "withholdingReceivable"
  /** Cobros y pagos pendientes de aplicación (555). */
  | "suspense";

export type PostingSettings = {
  countryCode: string;
  prorrataPct: number;
  businessType: string;
  /** Código base de cada rol (PGC); se apunta siempre en su subcuenta canónica (477 → 47700000). */
  codes: Record<AccountRole, string>;
};

/** Información del apunte: concepto, tercero, documento y vencimiento. */
export type PostingLineMeta = {
  concept?: string | null;
  partnerId?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  documentId?: string | null;
  dueDate?: Date | null;
};

export type PostingLine = { accountId: string; debit: number | string; credit: number | string } & PostingLineMeta;
export type NormalizedPostingLine = { accountId: string; debit: string; credit: string } & PostingLineMeta;

type SettingsRow = {
  defaultCustomerAccountCode?: string | null;
  defaultSupplierAccountCode?: string | null;
  defaultSalesAccountCode?: string | null;
  defaultPurchaseAccountCode?: string | null;
  defaultBankAccountCode?: string | null;
  prorrataPct?: string | number | null;
  businessType?: string | null;
};

/**
 * Códigos de cuenta por rol (PGC 2024 para España). Función pura para poder testearla.
 * Ventas: 700 (mercaderías), salvo empresas de servicios, que venden en 705 (prestaciones de servicios).
 */
export function resolvePostingSettings(settings: SettingsRow | null | undefined, countryCode: string | null | undefined): PostingSettings {
  const country = (countryCode ?? "ES").toUpperCase();
  const template = getCompanyTemplate(country)?.settings;
  const isSpain = country === "ES";
  const prorrata = Number(settings?.prorrataPct ?? 100);
  const businessType = settings?.businessType ?? "both";
  const configuredSales = settings?.defaultSalesAccountCode ?? template?.defaultSalesAccountCode ?? "700";
  return {
    countryCode: country,
    prorrataPct: Number.isFinite(prorrata) ? Math.min(Math.max(prorrata, 0), 100) : 100,
    businessType,
    codes: {
      customer: settings?.defaultCustomerAccountCode ?? template?.defaultCustomerAccountCode ?? "4300",
      supplier: settings?.defaultSupplierAccountCode ?? template?.defaultSupplierAccountCode ?? "4100",
      sales: isSpain && configuredSales === "700" && businessType === "services" ? "705" : configuredSales,
      purchase: settings?.defaultPurchaseAccountCode ?? template?.defaultPurchaseAccountCode ?? "600",
      bank: settings?.defaultBankAccountCode ?? template?.defaultBankAccountCode ?? "572",
      vatOutput: template?.defaultVatOutputAccountCode ?? "477",
      vatInput: template?.defaultVatInputAccountCode ?? "472",
      withholdingPayable: isSpain ? "4751" : template?.defaultRetentionAccountCode ?? "4751",
      withholdingReceivable: isSpain ? "473" : template?.defaultRetentionAccountCode ?? "473",
      suspense: isSpain ? "555" : template?.defaultBankAccountCode ?? "555",
    },
  };
}

async function fetchPostingSettings(companyId: string, client: DbClient): Promise<PostingSettings> {
  // Ambas lecturas en paralelo (el orden de las consultas se mantiene).
  const [[settings], [companyRow]] = await Promise.all([
    client
      .select({
        defaultCustomerAccountCode: companySettings.defaultCustomerAccountCode,
        defaultSupplierAccountCode: companySettings.defaultSupplierAccountCode,
        defaultSalesAccountCode: companySettings.defaultSalesAccountCode,
        defaultPurchaseAccountCode: companySettings.defaultPurchaseAccountCode,
        defaultBankAccountCode: companySettings.defaultBankAccountCode,
        prorrataPct: companySettings.prorrataPct,
        businessType: companySettings.businessType,
      })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1),
    client
      .select({ countryCode: company.countryCode })
      .from(company)
      .where(eq(company.id, companyId))
      .limit(1),
  ]);
  return resolvePostingSettings(settings, companyRow?.countryCode);
}

/**
 * Memo por transacción: la importación CSV o una conversión con varios asientos leen los ajustes
 * una sola vez por empresa. Solo con clientes de transacción (el `db` global vive entre peticiones
 * y los ajustes pueden cambiar); el WeakMap se libera con la transacción.
 */
const postingSettingsByTransaction = new WeakMap<object, Map<string, Promise<PostingSettings>>>();

export async function loadPostingSettings(companyId: string, client: DbClient = db): Promise<PostingSettings> {
  if (client === db) return fetchPostingSettings(companyId, client);
  let byCompany = postingSettingsByTransaction.get(client);
  if (!byCompany) {
    byCompany = new Map();
    postingSettingsByTransaction.set(client, byCompany);
  }
  let pending = byCompany.get(companyId);
  if (!pending) {
    pending = fetchPostingSettings(companyId, client);
    byCompany.set(companyId, pending);
    const memo = byCompany;
    pending.catch(() => memo.delete(companyId));
  }
  return pending;
}

/**
 * Subcuentas de cada rol (477 → 47700000…), creadas si faltan con su cadena de grupos del PGC.
 * Ajustes y subcuentas se memoizan por transacción.
 */
export async function resolveAccounts<R extends AccountRole>(companyId: string, roles: R[], client: DbClient) {
  const settings = await loadPostingSettings(companyId, client);
  const ids = {} as Record<R, string>;
  for (const role of roles) {
    ids[role] = (await ensureSubaccount(companyId, settings.codes[role], client)).id;
  }
  return { ids, settings };
}

/**
 * Subcuenta (grupo 57) asociada a una cuenta bancaria o a la cuenta bancaria de una forma de pago.
 * Si el banco está vinculado a una cuenta de grupo (572) se usa su subcuenta canónica.
 * Devuelve null si no hay vínculo y debe usarse la cuenta de bancos por defecto.
 */
const bankLedgerByTransaction = new WeakMap<object, Map<string, Promise<string | null>>>();

export async function resolveBankLedgerAccountId(
  client: DbClient,
  companyId: string,
  source: { bankAccountId?: string | null; paymentMethodId?: string | null },
): Promise<string | null> {
  // Importación CSV: todas las filas son de la misma cuenta bancaria → una consulta por transacción.
  if (client === db || !source.bankAccountId || source.paymentMethodId) return lookupBankLedgerAccountId(client, companyId, source);
  let byKey = bankLedgerByTransaction.get(client);
  if (!byKey) {
    byKey = new Map();
    bankLedgerByTransaction.set(client, byKey);
  }
  const key = `${companyId}:${source.bankAccountId}`;
  let pending = byKey.get(key);
  if (!pending) {
    pending = lookupBankLedgerAccountId(client, companyId, source);
    byKey.set(key, pending);
    const memo = byKey;
    pending.catch(() => memo.delete(key));
  }
  return pending;
}

async function lookupBankLedgerAccountId(
  client: DbClient,
  companyId: string,
  source: { bankAccountId?: string | null; paymentMethodId?: string | null },
): Promise<string | null> {
  let bankAccountId = source.bankAccountId ?? null;
  if (!bankAccountId && source.paymentMethodId) {
    const [method] = await client
      .select({ bankAccountId: paymentMethod.bankAccountId })
      .from(paymentMethod)
      .where(and(eq(paymentMethod.id, source.paymentMethodId), eq(paymentMethod.companyId, companyId)))
      .limit(1);
    bankAccountId = method?.bankAccountId ?? null;
  }
  if (!bankAccountId) return null;
  const [linked] = await client
    .select({ accountId: accountChart.id })
    .from(bankAccount)
    .innerJoin(accountChart, eq(accountChart.id, bankAccount.accountId))
    .where(and(
      eq(bankAccount.id, bankAccountId),
      eq(bankAccount.companyId, companyId),
      eq(accountChart.companyId, companyId),
    ))
    .limit(1);
  return linked ? toPostableAccountId(companyId, linked.accountId, client) : null;
}

/**
 * Normaliza y valida las líneas de un asiento automático:
 * - convierte a céntimos enteros, pasa importes negativos al lado contrario y descarta líneas a cero;
 * - exige al menos dos líneas y Σdebe = Σhaber exacto en céntimos.
 * La información del apunte (concepto, tercero, documento) viaja con cada línea.
 */
export function normalizePostingLines(lines: PostingLine[]): NormalizedPostingLine[] {
  const normalized = lines
    .map((line) => {
      const net = toCents(line.debit) - toCents(line.credit);
      return { line, debitCents: net > 0 ? net : 0, creditCents: net < 0 ? -net : 0 };
    })
    .filter((entry) => entry.debitCents > 0 || entry.creditCents > 0);

  if (normalized.length < 2) {
    throw new AccountingRuleError(422, "ENTRY_TOO_SHORT", "El asiento automático no contiene suficientes líneas con importe.");
  }
  const debit = sumCents(normalized.map((entry) => entry.debitCents));
  const credit = sumCents(normalized.map((entry) => entry.creditCents));
  if (debit !== credit) {
    throw new AccountingRuleError(
      422,
      "ENTRY_UNBALANCED",
      `El asiento automático está descuadrado (debe ${centsToAmount(debit)}, haber ${centsToAmount(credit)}). Revisa los importes del documento.`,
    );
  }
  return normalized.map(({ line, debitCents, creditCents }) => ({
    accountId: line.accountId,
    debit: centsToAmount(debitCents),
    credit: centsToAmount(creditCents),
    ...lineMeta(line),
  }));
}

const META_KEYS = ["concept", "partnerId", "documentType", "documentNumber", "documentId", "dueDate"] as const;

/** Solo las claves de información presentes (una línea sin ellas se queda como { accountId, debit, credit }). */
function lineMeta(line: PostingLineMeta): PostingLineMeta {
  const meta: PostingLineMeta = {};
  for (const key of META_KEYS) {
    if (line[key] === undefined) continue;
    if (key === "dueDate") meta.dueDate = line.dueDate;
    else meta[key] = line[key];
  }
  return meta;
}

/** Tolerancia de redondeo aceptada entre el total del documento y la suma de sus líneas: 1 céntimo por línea (mín. 2). */
function roundingToleranceCents(lineCount: number) {
  return Math.max(2, lineCount);
}

/**
 * Ajusta la diferencia de redondeo (en céntimos) en la línea de mayor importe del lado indicado.
 * Si la diferencia supera la tolerancia se considera un documento incoherente y se rechaza.
 */
function absorbRoundingDifference(
  lines: Array<{ accountId: string; debitCents: number; creditCents: number }>,
  side: "debit" | "credit",
  documentLineCount: number,
) {
  const debit = sumCents(lines.map((line) => line.debitCents));
  const credit = sumCents(lines.map((line) => line.creditCents));
  const difference = side === "debit" ? credit - debit : debit - credit;
  if (difference === 0) return lines;
  if (Math.abs(difference) > roundingToleranceCents(documentLineCount)) {
    throw new AccountingRuleError(
      422,
      "ENTRY_UNBALANCED",
      `El total del documento no coincide con la suma de sus líneas (diferencia ${centsToAmount(difference)}). Revisa importes e impuestos.`,
    );
  }
  const key = side === "debit" ? "debitCents" : "creditCents";
  let target = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index][key] > 0 && (target < 0 || lines[index][key] >= lines[target][key])) target = index;
  }
  if (target < 0) throw new AccountingRuleError(422, "ENTRY_UNBALANCED", "No se pudo cuadrar el asiento automático.");
  lines[target] = { ...lines[target], [key]: lines[target][key] + difference };
  return lines;
}

function toPostingLines(lines: Array<{ accountId: string; debitCents: number; creditCents: number }>): PostingLine[] {
  return lines.map((line) => ({ accountId: line.accountId, debit: centsToAmount(line.debitCents), credit: centsToAmount(line.creditCents) }));
}

/**
 * Aplica el documento de origen a todas las líneas del asiento. El vencimiento solo se guarda en
 * los apuntes del tercero (`partyAccountIds`: 430/400/410), que son los que se casan y puntean.
 */
export function withLineDocument(lines: PostingLine[], document: LineDocument | null, partyAccountIds: Iterable<string> = []): PostingLine[] {
  if (!document) return lines;
  const party = new Set(partyAccountIds);
  return lines.map((line) => ({
    ...line,
    concept: line.concept ?? document.concept,
    partnerId: line.partnerId ?? document.partnerId,
    documentType: line.documentType ?? document.documentType,
    documentNumber: line.documentNumber ?? document.documentNumber,
    documentId: line.documentId ?? document.documentId,
    dueDate: line.dueDate ?? (party.has(line.accountId) ? document.dueDate : null),
  }));
}

/**
 * Lleva cada línea a su subcuenta canónica (una cuenta de grupo o de otra longitud nunca recibe
 * apuntes automáticos) y completa el tercero con el de la subcuenta si la línea no lo trae.
 */
async function toPostableLines(client: DbClient, companyId: string, lines: NormalizedPostingLine[]) {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  const context = await loadChartContext(companyId, client);
  const rows = await client
    .select({ id: accountChart.id, code: accountChart.code, partnerId: accountChart.partnerId })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const postableById = new Map<string, string>();
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new AccountingRuleError(422, "ACCOUNT_INVALID", "Alguna cuenta del asiento no existe en el plan contable de la empresa.");
    postableById.set(id, isCanonicalSubaccountCode(row.code, context.subaccountLength) ? id : await toPostableAccountId(companyId, id, client));
  }
  return lines.map((line) => {
    const accountId = postableById.get(line.accountId) ?? line.accountId;
    return { ...line, accountId, partnerId: line.partnerId ?? byId.get(line.accountId)?.partnerId ?? null };
  });
}

export async function createAutomaticEntry(
  input: PostingInput & {
    lines: PostingLine[];
    action: string;
    entityName: string;
    entityId: string;
    sourceType?: string;
    sourceId?: string;
  },
) {
  const client = input.dbClient ?? db;
  const sourceType = input.sourceType ?? input.entityName;
  const postingLines = await toPostableLines(client, input.companyId, normalizePostingLines(input.lines));
  const targetJournal = await ensureJournal(input.companyId, journalCodeForSource(sourceType), client);
  const { number, fiscalYearId } = await reserveJournalEntryNumber(client, input.companyId, input.postedAt);
  const [createdEntry] = await client
    .insert(journalEntry)
    .values({
      companyId: input.companyId,
      number,
      fiscalYearId,
      journalId: targetJournal.id,
      postedAt: input.postedAt,
      reference: input.reference,
      sourceType,
      sourceId: input.sourceId ?? input.entityId,
      isAutomatic: true,
    })
    .returning({ id: journalEntry.id });

  await client.insert(journalLine).values(
    postingLines.map((line, index) => ({
      journalEntryId: createdEntry.id,
      lineNumber: index + 1,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      concept: line.concept?.trim() || input.reference.slice(0, 200),
      partnerId: line.partnerId ?? null,
      documentType: line.documentType ?? null,
      documentNumber: line.documentNumber ?? null,
      documentId: line.documentId ?? null,
      dueDate: line.dueDate ?? null,
    })),
  );
  await client
    .update(accountChart)
    .set({ isActive: true })
    .where(and(eq(accountChart.companyId, input.companyId), inArray(accountChart.id, [...new Set(postingLines.map((line) => line.accountId))])));

  await recordAudit(
    {
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityName: input.entityName,
      entityId: input.entityId,
      payload: { journalEntryId: createdEntry.id, number, reference: input.reference },
    },
    client,
  );

  return { id: createdEntry.id, number };
}

export async function reverseAutomaticEntries(input: PostingInput & { sourceType: string; sourceId: string; reason: string }) {
  const client = input.dbClient ?? db;
  const entries = await client
    .select({ id: journalEntry.id, journalId: journalEntry.journalId })
    .from(journalEntry)
    .where(and(
      eq(journalEntry.companyId, input.companyId),
      eq(journalEntry.sourceType, input.sourceType),
      eq(journalEntry.sourceId, input.sourceId),
      eq(journalEntry.isAutomatic, true),
      isNull(journalEntry.reversedAt),
      isNull(journalEntry.reversesEntryId),
    ));

  for (const entry of entries) {
    const lines = await client
      .select()
      .from(journalLine)
      .where(eq(journalLine.journalEntryId, entry.id))
      .orderBy(asc(journalLine.lineNumber), asc(journalLine.id));
    const { number, fiscalYearId } = await reserveJournalEntryNumber(client, input.companyId, input.postedAt);
    const [reversal] = await client.insert(journalEntry).values({
      companyId: input.companyId,
      number,
      fiscalYearId,
      journalId: entry.journalId,
      postedAt: input.postedAt,
      reference: input.reason,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      isAutomatic: true,
      reversesEntryId: entry.id,
    }).returning({ id: journalEntry.id });
    if (lines.length > 0) {
      await client.insert(journalLine).values(lines.map((line, index) => ({
        journalEntryId: reversal.id,
        lineNumber: index + 1,
        accountId: line.accountId,
        debit: line.credit,
        credit: line.debit,
        concept: reversalConcept(line.concept, input.reason),
        partnerId: line.partnerId,
        documentType: line.documentType,
        documentNumber: line.documentNumber,
        documentId: line.documentId,
        dueDate: line.dueDate,
        costCenterId: line.costCenterId,
      })));
    }
    await client.update(journalEntry).set({ reversedAt: input.postedAt }).where(eq(journalEntry.id, entry.id));
  }

  if (entries.length > 0) {
    await recordAudit({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: "accounting.reverse.automatic",
      entityName: input.sourceType,
      entityId: input.sourceId,
      payload: { reason: input.reason, reversedEntryIds: entries.map((entry) => entry.id) },
    }, client);
  }
  return entries.length;
}

/** Reparte la base entre cuentas de ventas y cuadra el redondeo en la de mayor importe (céntimos exactos). */
function splitSales(subtotalCents: number, defaultSalesId: string, salesByAccount?: Array<{ accountId: string; subtotal: number }>) {
  const grouped = new Map<string, number>();
  for (const entry of salesByAccount ?? []) grouped.set(entry.accountId, (grouped.get(entry.accountId) ?? 0) + toCents(entry.subtotal));
  if (grouped.size === 0) return [{ accountId: defaultSalesId, cents: subtotalCents }];
  const split = [...grouped.entries()].map(([accountId, cents]) => ({ accountId, cents }));
  const difference = subtotalCents - sumCents(split.map((entry) => entry.cents));
  if (difference !== 0) {
    let target = 0;
    for (let index = 1; index < split.length; index += 1) if (Math.abs(split[index].cents) > Math.abs(split[target].cents)) target = index;
    split[target] = { ...split[target], cents: split[target].cents + difference };
  }
  return split;
}

/** Líneas del asiento de una factura emitida (función pura). `salesByAccount` reparte la base por cuenta de ventas. */
export function buildSalesInvoiceLines(
  accounts: { customer: string; sales: string; vatOutput: string; withholdingReceivable: string },
  amounts: { subtotal: number; taxAmount: number; totalAmount: number; retentionAmount?: number },
  salesByAccount?: Array<{ accountId: string; subtotal: number }>,
): PostingLine[] {
  const retention = Math.max(toCents(amounts.retentionAmount ?? 0), 0);
  const lines = [
    { accountId: accounts.customer, debitCents: toCents(amounts.totalAmount), creditCents: 0 },
    { accountId: accounts.withholdingReceivable, debitCents: retention, creditCents: 0 },
    ...splitSales(toCents(amounts.subtotal), accounts.sales, salesByAccount).map((entry) => ({ accountId: entry.accountId, debitCents: 0, creditCents: entry.cents })),
    { accountId: accounts.vatOutput, debitCents: 0, creditCents: toCents(amounts.taxAmount) },
  ];
  return toPostingLines(absorbRoundingDifference(lines, "credit", 4));
}

export type SalesLineInput = { itemId?: string | null; subtotal: number };

/**
 * Cuenta de ventas de cada línea: la del artículo si la tiene; si no, 705 para servicios y 700 para
 * mercaderías (PGC), o la cuenta de ventas por defecto de la empresa (700/705 según su actividad).
 */
async function resolveSalesSplit(client: DbClient, companyId: string, settings: PostingSettings, lines: SalesLineInput[] | undefined) {
  if (!lines || lines.length === 0) return undefined;
  const itemIds = [...new Set(lines.map((line) => line.itemId).filter((id): id is string => Boolean(id)))];
  const items = itemIds.length > 0
    ? await client
        .select({ id: item.id, salesAccountId: item.salesAccountId, isService: item.isService })
        .from(item)
        .where(and(eq(item.companyId, companyId), inArray(item.id, itemIds)))
    : [];
  const byItem = new Map(items.map((row) => [row.id, row]));
  const standardSalesCode = settings.countryCode === "ES" && ["700", "705"].includes(settings.codes.sales);
  const split: Array<{ accountId: string; subtotal: number }> = [];
  for (const line of lines) {
    const itemRow = line.itemId ? byItem.get(line.itemId) : undefined;
    let accountId: string;
    if (itemRow?.salesAccountId) {
      accountId = itemRow.salesAccountId;
    } else if (itemRow && standardSalesCode) {
      accountId = (await ensureSubaccount(companyId, itemRow.isService ? "705" : "700", client)).id;
    } else {
      accountId = (await ensureSubaccount(companyId, settings.codes.sales, client)).id;
    }
    split.push({ accountId, subtotal: line.subtotal });
  }
  return split;
}

/** Subcuenta del tercero para un rol; sin tercero (datos antiguos) se usa la subcuenta genérica del rol. */
async function partyAccountId(
  client: DbClient,
  companyId: string,
  partnerId: string | null,
  role: PartnerAccountRole,
  fallbackId: string,
  prefix?: string,
) {
  if (!partnerId) return fallbackId;
  return (await ensurePartnerSubaccount({ id: partnerId, companyId }, { role, prefix, client })).id;
}

/**
 * Subcuenta del tercero que usó el asiento del documento (factura) para que el cobro o pago salde
 * la misma cuenta, aunque después cambie el tipo de proveedor (400 ↔ 410).
 */
async function documentPartyAccount(
  client: DbClient,
  companyId: string,
  source: { sourceType: string; sourceId: string },
  groupPrefixes: string[],
) {
  const [row] = await client
    .select({ accountId: journalLine.accountId, code: accountChart.code, partnerId: accountChart.partnerId })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(
      eq(journalEntry.companyId, companyId),
      eq(journalEntry.sourceType, source.sourceType),
      eq(journalEntry.sourceId, source.sourceId),
      isNull(journalEntry.reversesEntryId),
      or(...groupPrefixes.map((prefix) => sql`${accountChart.code} like ${`${prefix}%`}`)),
    ))
    .orderBy(asc(journalEntry.postedAt))
    .limit(1);
  return row ?? null;
}

async function settlementPartyAccountId(
  client: DbClient,
  companyId: string,
  input: { partnerId: string | null; role: PartnerAccountRole; fallbackId: string; documentSource: { sourceType: string; sourceId: string } | null },
) {
  const settings = await loadPostingSettings(companyId, client);
  const prefixes = settings.countryCode === "ES"
    ? input.role === "customer" ? ["43"] : ["40", "41"]
    : [(input.role === "customer" ? settings.codes.customer : settings.codes.supplier).slice(0, 2)];
  const previous = input.documentSource ? await documentPartyAccount(client, companyId, input.documentSource, prefixes) : null;
  if (!previous) return partyAccountId(client, companyId, input.partnerId, input.role, input.fallbackId);
  const context = await loadChartContext(companyId, client);
  if (isCanonicalSubaccountCode(previous.code, context.subaccountLength) && (!input.partnerId || previous.partnerId === input.partnerId)) {
    return previous.accountId;
  }
  return partyAccountId(client, companyId, input.partnerId, input.role, input.fallbackId, previous.code.slice(0, 3));
}

/**
 * Factura emitida: 430 del cliente (total a cobrar) + 473 (retención IRPF que nos practica el
 * cliente) a 700/705 o la cuenta de ventas del artículo (base) + 477 (IVA y recargo repercutidos).
 */
export async function postSalesInvoice(
  input: PostingInput & {
    invoiceId: string;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    retentionAmount?: number;
    lines?: SalesLineInput[];
  },
) {
  const client = input.dbClient ?? db;
  const hasRetention = (input.retentionAmount ?? 0) > 0;
  const roles: AccountRole[] = hasRetention ? ["customer", "sales", "vatOutput", "withholdingReceivable"] : ["customer", "sales", "vatOutput"];
  const { ids, settings } = await resolveAccounts(input.companyId, roles, client);
  const context = await loadInvoicePostingContext(client, input.companyId, input.invoiceId);
  const customerId = await partyAccountId(client, input.companyId, context?.partnerId ?? null, "customer", ids.customer);
  const salesSplit = await resolveSalesSplit(client, input.companyId, settings, input.lines);
  // Sin retención la línea 473 queda a cero y se descarta; se usa la cuenta de cliente como marcador.
  const lines = buildSalesInvoiceLines(
    { customer: customerId, sales: ids.sales, vatOutput: ids.vatOutput, withholdingReceivable: ids.withholdingReceivable ?? customerId },
    input,
    salesSplit,
  );

  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.salesInvoice",
    entityName: "invoice",
    entityId: input.invoiceId,
    lines: withLineDocument(lines, context ? invoiceLineDocument(context) : null, [customerId]),
  });
}

export type SupplierExpenseLine = {
  accountId?: string | null;
  subtotal: number;
  taxAmount?: number;
  taxDeductiblePct?: number;
  retentionAmount?: number;
};

/**
 * Líneas del asiento de una factura recibida, en céntimos enteros (función pura).
 *
 * - IVA deducible = cuota × % deducible de la línea × prorrata; el resto es mayor gasto de la línea.
 * - ISP / adquisición intracomunitaria: la cuota se autorepercute (477 al haber) y se deduce (472)
 *   con las mismas reglas; el proveedor solo se acredita por base − retención.
 * - Retenciones practicadas → 4751 al haber.
 * - Si el total del documento difiere de la suma de líneas por redondeo, la diferencia se
 *   carga en la línea de gasto de mayor importe.
 */
export function buildSupplierInvoiceLines(input: {
  accounts: { purchase: string; supplier: string; vatInput: string; vatOutput: string; withholdingPayable: string };
  expenseLines: SupplierExpenseLine[];
  totalAmount: number;
  prorrataPct: number;
  vatTreatment: SupplierVatTreatment;
}): PostingLine[] {
  const selfAssessed = isSelfAssessedTreatment(input.vatTreatment);
  const expenseByAccount = new Map<string, number>();
  let deductibleCents = 0;
  let selfAssessedCents = 0;
  let subtotalCents = 0;
  let retentionCents = 0;

  for (const line of input.expenseLines) {
    const accountId = line.accountId || input.accounts.purchase;
    const lineSubtotal = toCents(line.subtotal);
    const chargedTax = toCents(line.taxAmount ?? 0);
    const vatCents = selfAssessed ? toCents(reverseChargeTaxAmount(line.subtotal, line.taxAmount ?? 0)) : chargedTax;
    const lineDeductiblePct = Math.min(Math.max(line.taxDeductiblePct ?? 100, 0), 100);
    const effectivePct = (lineDeductiblePct * input.prorrataPct) / 100;
    const deductible = applyPct(vatCents, effectivePct);
    const nonDeductible = vatCents - deductible;

    expenseByAccount.set(accountId, (expenseByAccount.get(accountId) ?? 0) + lineSubtotal + nonDeductible);
    deductibleCents += deductible;
    subtotalCents += lineSubtotal;
    if (selfAssessed) selfAssessedCents += vatCents;
    retentionCents += Math.max(toCents(line.retentionAmount ?? 0), 0);
  }

  const supplierCents = selfAssessed ? subtotalCents - retentionCents : toCents(input.totalAmount);
  const lines = [
    ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({ accountId, debitCents: cents, creditCents: 0 })),
    { accountId: input.accounts.vatInput, debitCents: deductibleCents, creditCents: 0 },
    { accountId: input.accounts.supplier, debitCents: 0, creditCents: supplierCents },
    { accountId: input.accounts.withholdingPayable, debitCents: 0, creditCents: retentionCents },
    { accountId: input.accounts.vatOutput, debitCents: 0, creditCents: selfAssessedCents },
  ];
  return toPostingLines(absorbRoundingDifference(lines, "debit", input.expenseLines.length + 2));
}

async function lookupSupplierVatTreatment(client: DbClient, companyId: string, supplierInvoiceId: string): Promise<SupplierVatTreatment> {
  const [row] = await client
    .select({ vatTreatment: supplierInvoice.vatTreatment, countryCode: partner.countryCode })
    .from(supplierInvoice)
    .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(eq(supplierInvoice.id, supplierInvoiceId), eq(supplierInvoice.companyId, companyId)))
    .limit(1);
  return resolveSupplierVatTreatment(row?.vatTreatment, row?.countryCode);
}

/** Factura recibida: gastos (6xx/2xx) + 472 a la subcuenta del proveedor (400/410) + 4751 (+ 477 en ISP). */
export async function postSupplierInvoice(
  input: PostingInput & {
    supplierInvoiceId: string;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    retentionAmount?: number;
    vatTreatment?: SupplierVatTreatment;
    expenseLines?: SupplierExpenseLine[];
  },
) {
  const client = input.dbClient ?? db;
  const { ids, settings } = await resolveAccounts(
    input.companyId,
    ["purchase", "supplier", "vatInput", "vatOutput", "withholdingPayable"],
    client,
  );
  const context = await loadSupplierInvoicePostingContext(client, input.companyId, input.supplierInvoiceId);
  const supplierId = await partyAccountId(client, input.companyId, context?.partnerId ?? null, "supplier", ids.supplier);
  const vatTreatment = input.vatTreatment ?? (await lookupSupplierVatTreatment(client, input.companyId, input.supplierInvoiceId));
  const expenseLines = input.expenseLines && input.expenseLines.length > 0
    ? input.expenseLines
    : [{ accountId: ids.purchase, subtotal: input.subtotal, taxAmount: input.taxAmount, taxDeductiblePct: 100, retentionAmount: input.retentionAmount ?? 0 }];

  const lines = buildSupplierInvoiceLines({
    accounts: { ...ids, supplier: supplierId },
    expenseLines,
    totalAmount: input.totalAmount,
    prorrataPct: settings.prorrataPct,
    vatTreatment,
  });
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.supplierInvoice",
    entityName: "supplierInvoice",
    entityId: input.supplierInvoiceId,
    lines: withLineDocument(lines, context ? supplierInvoiceLineDocument(context) : null, [supplierId]),
  });
}

/** Cobro de cliente: banco de la forma de pago (o 572) a la subcuenta 430 del cliente. */
export async function postCustomerPayment(
  input: PostingInput & { paymentId: string; amount: number; paymentMethodId?: string | null; bankAccountId?: string | null },
) {
  const client = input.dbClient ?? db;
  const { ids } = await resolveAccounts(input.companyId, ["bank", "customer"], client);
  const bankId = (await resolveBankLedgerAccountId(client, input.companyId, input)) ?? ids.bank;
  const context = await loadCustomerPaymentPostingContext(client, input.companyId, input.paymentId);
  const customerId = await settlementPartyAccountId(client, input.companyId, {
    partnerId: context?.partnerId ?? null,
    role: "customer",
    fallbackId: ids.customer,
    documentSource: context ? { sourceType: "invoice", sourceId: context.invoiceId } : null,
  });
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.customerPayment",
    entityName: "payment",
    entityId: input.paymentId,
    lines: withLineDocument([
      { accountId: bankId, debit: input.amount, credit: 0 },
      { accountId: customerId, debit: 0, credit: input.amount },
    ], context ? customerPaymentLineDocument(context) : null, [customerId]),
  });
}

/** Pago a proveedor: subcuenta 400/410 del proveedor a banco de la cuenta o forma de pago elegida (o 572). */
export async function postSupplierPayment(
  input: PostingInput & { supplierPaymentId: string; amount: number; paymentMethodId?: string | null; bankAccountId?: string | null },
) {
  const client = input.dbClient ?? db;
  const { ids } = await resolveAccounts(input.companyId, ["bank", "supplier"], client);
  const bankId = (await resolveBankLedgerAccountId(client, input.companyId, input)) ?? ids.bank;
  const context = await loadSupplierPaymentPostingContext(client, input.companyId, input.supplierPaymentId);
  const supplierId = await settlementPartyAccountId(client, input.companyId, {
    partnerId: context?.partnerId ?? null,
    role: "supplier",
    fallbackId: ids.supplier,
    documentSource: context?.invoice ? { sourceType: "supplierInvoice", sourceId: context.invoice.supplierInvoiceId } : null,
  });
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.supplierPayment",
    entityName: "supplierPayment",
    entityId: input.supplierPaymentId,
    lines: withLineDocument([
      { accountId: supplierId, debit: input.amount, credit: 0 },
      { accountId: bankId, debit: 0, credit: input.amount },
    ], context ? supplierPaymentLineDocument(context) : null, [supplierId]),
  });
}

/**
 * Movimiento bancario sin aplicar (manual o importado del extracto).
 *
 * Se contabiliza contra 555 "Partidas pendientes de aplicación": el banco refleja el extracto,
 * pero todavía no sabemos a qué cliente, proveedor o gasto corresponde. Al conciliarlo con un
 * cobro o pago (que ya contabilizó banco contra 430/400) este asiento se revierte, de forma que
 * solo queda un efecto en el banco y 555 vuelve a cero. Al desconciliar se vuelve a contabilizar.
 */
export async function postBankTransaction(
  input: PostingInput & { bankTransactionId: string; amount: number; bankAccountId?: string | null },
) {
  const client = input.dbClient ?? db;
  const { ids } = await resolveAccounts(input.companyId, ["bank", "suspense"], client);
  const bankId = (await resolveBankLedgerAccountId(client, input.companyId, { bankAccountId: input.bankAccountId })) ?? ids.bank;
  const amount = Math.abs(input.amount);
  const isDeposit = input.amount >= 0;
  const document = await loadBankTransactionLineDocument(client, input.bankTransactionId);
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.bankTransaction",
    entityName: "bankTransaction",
    entityId: input.bankTransactionId,
    lines: withLineDocument(isDeposit
      ? [
          { accountId: bankId, debit: amount, credit: 0 },
          { accountId: ids.suspense, debit: 0, credit: amount },
        ]
      : [
          { accountId: ids.suspense, debit: amount, credit: 0 },
          { accountId: bankId, debit: 0, credit: amount },
        ], document),
  });
}

/**
 * Líneas del asiento de una factura rectificativa (función pura, céntimos exactos).
 *
 * Mismas cuentas que la factura emitida (430 + 473 a 700 + 477) pero con importes con signo:
 * una rectificativa en negativo (abono) invierte el asiento original — 700 y 477 al debe, 430 y
 * 473 al haber — y una en positivo (rectificación al alza) se contabiliza como una venta.
 * Exige total + retención = base + cuota (lo garantiza el motor fiscal), así que siempre cuadra.
 */
export function buildCreditNoteLines(
  accounts: { customer: string; sales: string; vatOutput: string; withholdingReceivable: string },
  amounts: { subtotal: number; taxAmount: number; totalAmount: number; retentionAmount?: number },
  salesByAccount?: Array<{ accountId: string; subtotal: number }>,
): PostingLine[] {
  const total = toCents(amounts.totalAmount);
  const retention = toCents(amounts.retentionAmount ?? 0);
  const subtotal = toCents(amounts.subtotal);
  const tax = toCents(amounts.taxAmount);
  if (total + retention !== subtotal + tax) {
    throw new AccountingRuleError(
      422,
      "ENTRY_UNBALANCED",
      `La rectificativa no cuadra (total ${centsToAmount(total)} + retención ${centsToAmount(retention)} ≠ base ${centsToAmount(subtotal)} + cuota ${centsToAmount(tax)}).`,
    );
  }
  const signed = [
    { accountId: accounts.customer, net: total },
    { accountId: accounts.withholdingReceivable, net: retention },
    ...splitSales(subtotal, accounts.sales, salesByAccount).map((entry) => ({ accountId: entry.accountId, net: -entry.cents })),
    { accountId: accounts.vatOutput, net: -tax },
  ];
  // Importes negativos → lado contrario (un abono queda como el asiento inverso de la venta).
  return signed.map((line) => ({
    accountId: line.accountId,
    debit: line.net > 0 ? centsToAmount(line.net) : "0.00",
    credit: line.net < 0 ? centsToAmount(-line.net) : "0.00",
  }));
}

/** Factura rectificativa emitida: asiento inverso (o complementario) al de la factura original. */
export async function postCreditNote(
  input: PostingInput & {
    invoiceId: string;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    retentionAmount?: number;
    lines?: SalesLineInput[];
  },
) {
  const client = input.dbClient ?? db;
  const hasRetention = (input.retentionAmount ?? 0) !== 0;
  const roles: AccountRole[] = hasRetention ? ["customer", "sales", "vatOutput", "withholdingReceivable"] : ["customer", "sales", "vatOutput"];
  const { ids, settings } = await resolveAccounts(input.companyId, roles, client);
  const context = await loadInvoicePostingContext(client, input.companyId, input.invoiceId);
  const customerId = await partyAccountId(client, input.companyId, context?.partnerId ?? null, "customer", ids.customer);
  const salesSplit = await resolveSalesSplit(client, input.companyId, settings, input.lines);
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.creditNote",
    entityName: "invoice",
    entityId: input.invoiceId,
    lines: withLineDocument(buildCreditNoteLines(
      { customer: customerId, sales: ids.sales, vatOutput: ids.vatOutput, withholdingReceivable: ids.withholdingReceivable ?? customerId },
      input,
      salesSplit,
    ), context ? invoiceLineDocument(context) : null, [customerId]),
  });
}

/**
 * Líneas de "Asignar a cuenta" de un movimiento bancario (función pura).
 *
 * `movementAmount` es el importe con signo del extracto; cada partida va en el sentido del
 * movimiento (positiva = misma dirección; negativa = dirección contraria, p. ej. una comisión
 * descontada de un cobro). Ingreso: Banco al debe y cuentas al haber; cargo: cuentas al debe y
 * Banco al haber. Las partidas negativas pasan al lado contrario, así que el asiento siempre cuadra.
 */
export function buildBankAssignmentLines(
  bankAccountId: string,
  movementAmount: number,
  allocations: Array<{ accountId: string; amount: number | string } & PostingLineMeta>,
): PostingLine[] {
  const direction = movementAmount >= 0 ? 1 : -1;
  const lines: PostingLine[] = [];
  let bankNetCents = 0;
  for (const allocation of allocations) {
    const { accountId, amount, ...meta } = allocation;
    const cents = toCents(amount);
    bankNetCents += direction * cents;
    const accountNet = -direction * cents;
    lines.push({
      ...meta,
      accountId,
      debit: accountNet > 0 ? centsToAmount(accountNet) : "0.00",
      credit: accountNet < 0 ? centsToAmount(-accountNet) : "0.00",
    });
  }
  lines.unshift({
    accountId: bankAccountId,
    debit: bankNetCents > 0 ? centsToAmount(bankNetCents) : "0.00",
    credit: bankNetCents < 0 ? centsToAmount(-bankNetCents) : "0.00",
  });
  return normalizePostingLines(lines);
}

/**
 * Parte de un movimiento bancario asignada directamente a cuentas (comisiones 626, cuota de
 * autónomos 642, pagos a Hacienda 4750…): Banco ↔ cuentas, con origen
 * `bankTransactionAssignment` para poder revertirlo al deshacer. El asiento provisional del
 * movimiento (Banco ↔ 555) lo revierte quien llama, de modo que 555 vuelve a cero.
 */
export async function postBankTransactionAssignment(
  input: PostingInput & {
    bankTransactionId: string;
    bankAccountId: string;
    movementAmount: number;
    allocations: Array<{ accountId: string; amount: number | string } & PostingLineMeta>;
  },
) {
  const client = input.dbClient ?? db;
  const { ids } = await resolveAccounts(input.companyId, ["bank"], client);
  const bankId = (await resolveBankLedgerAccountId(client, input.companyId, { bankAccountId: input.bankAccountId })) ?? ids.bank;
  const document = await loadBankTransactionLineDocument(client, input.bankTransactionId);
  return createAutomaticEntry({
    ...input,
    action: "accounting.autopost.bankTransactionAssignment",
    entityName: "bankTransaction",
    entityId: input.bankTransactionId,
    sourceType: "bankTransactionAssignment",
    sourceId: input.bankTransactionId,
    lines: withLineDocument(
      buildBankAssignmentLines(bankId, input.movementAmount, input.allocations),
      document ? { ...document, concept: input.reference.slice(0, 200) || document.concept } : null,
    ),
  });
}
