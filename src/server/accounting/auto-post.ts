import { and, eq, inArray, isNull } from "drizzle-orm";

import { accountChart, bankAccount, company, companySettings, journalEntry, journalLine, partner, paymentMethod, supplierInvoice } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCompanyTemplate } from "@/lib/company-templates";
import {
  isSelfAssessedTreatment,
  resolveSupplierVatTreatment,
  reverseChargeTaxAmount,
  type SupplierVatTreatment,
} from "@/lib/fiscal-spain";
import { AccountingRuleError } from "@/server/accounting/errors";
import { applyPct, centsToAmount, sumCents, toCents } from "@/server/accounting/money";
import { reserveJournalEntryNumber } from "@/server/accounting/numbers";
import { ensureDefaultJournal } from "@/server/accounting/service";
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
  codes: Record<AccountRole, string>;
};

export type PostingLine = { accountId: string; debit: number | string; credit: number | string };
export type NormalizedPostingLine = { accountId: string; debit: string; credit: string };

type SettingsRow = {
  defaultCustomerAccountCode?: string | null;
  defaultSupplierAccountCode?: string | null;
  defaultSalesAccountCode?: string | null;
  defaultPurchaseAccountCode?: string | null;
  defaultBankAccountCode?: string | null;
  prorrataPct?: string | number | null;
};

/** Códigos de cuenta por rol (PGC 2024 para España). Función pura para poder testearla. */
export function resolvePostingSettings(settings: SettingsRow | null | undefined, countryCode: string | null | undefined): PostingSettings {
  const country = (countryCode ?? "ES").toUpperCase();
  const template = getCompanyTemplate(country)?.settings;
  const isSpain = country === "ES";
  const prorrata = Number(settings?.prorrataPct ?? 100);
  return {
    countryCode: country,
    prorrataPct: Number.isFinite(prorrata) ? Math.min(Math.max(prorrata, 0), 100) : 100,
    codes: {
      customer: settings?.defaultCustomerAccountCode ?? template?.defaultCustomerAccountCode ?? "4300",
      supplier: settings?.defaultSupplierAccountCode ?? template?.defaultSupplierAccountCode ?? "4100",
      sales: settings?.defaultSalesAccountCode ?? template?.defaultSalesAccountCode ?? "700",
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

export async function loadPostingSettings(companyId: string, client: DbClient = db): Promise<PostingSettings> {
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

type ResolvedPostingAccounts = { settings: PostingSettings; idByCode: Map<string, string> };

/**
 * Memo por transacción: la importación CSV o una conversión con varios asientos resuelven
 * ajustes y cuentas una sola vez por empresa. Solo se memoiza con clientes de transacción
 * (el `db` global vive entre peticiones y los ajustes pueden cambiar); el WeakMap se
 * libera con la transacción.
 */
const postingAccountsByTransaction = new WeakMap<object, Map<string, Promise<ResolvedPostingAccounts>>>();

async function fetchPostingAccounts(companyId: string, client: DbClient): Promise<ResolvedPostingAccounts> {
  const settings = await loadPostingSettings(companyId, client);
  // Una sola consulta con TODAS las cuentas por rol: cualquier asiento posterior de la misma
  // transacción reutiliza el resultado sin volver a la base de datos.
  const codes = [...new Set(Object.values(settings.codes))];
  const rows = await client
    .select({ id: accountChart.id, code: accountChart.code })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.code, codes), eq(accountChart.isPostable, true)));
  return { settings, idByCode: new Map(rows.map((row) => [row.code, row.id])) };
}

function loadPostingAccounts(companyId: string, client: DbClient, { refresh = false } = {}) {
  if (client === db) return { resolved: fetchPostingAccounts(companyId, client), cached: false };
  let byCompany = postingAccountsByTransaction.get(client);
  if (!byCompany) {
    byCompany = new Map();
    postingAccountsByTransaction.set(client, byCompany);
  }
  const existing = refresh ? undefined : byCompany.get(companyId);
  if (existing) return { resolved: existing, cached: true };
  const resolved = fetchPostingAccounts(companyId, client);
  byCompany.set(companyId, resolved);
  // Un fallo no debe quedar memoizado.
  resolved.catch(() => byCompany.delete(companyId));
  return { resolved, cached: false };
}

/** Ids de las cuentas postables de cada rol: 2 lecturas en paralelo + 1 consulta de cuentas, memoizadas por transacción. */
export async function resolveAccounts<R extends AccountRole>(companyId: string, roles: R[], client: DbClient) {
  let { resolved, cached } = loadPostingAccounts(companyId, client);
  let { settings, idByCode } = await resolved;
  // Si falta una cuenta y el dato venía del memo, se relee una vez por si se creó en esta transacción.
  if (cached && roles.some((role) => !idByCode.has(settings.codes[role]))) {
    ({ resolved, cached } = loadPostingAccounts(companyId, client, { refresh: true }));
    ({ settings, idByCode } = await resolved);
  }
  const ids = {} as Record<R, string>;
  for (const role of roles) {
    const code = settings.codes[role];
    const id = idByCode.get(code);
    if (!id) {
      throw new AccountingRuleError(
        422,
        "ACCOUNT_MISSING",
        `No existe la cuenta contable ${code} en el plan contable. Créala o revisa las cuentas por defecto en Contabilidad → Plan contable.`,
      );
    }
    ids[role] = id;
  }
  return { ids, settings };
}

/**
 * Cuenta contable (grupo 57) asociada a una cuenta bancaria o a la cuenta bancaria de una forma de pago.
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
    pending.catch(() => byKey.delete(key));
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
      eq(accountChart.isPostable, true),
    ))
    .limit(1);
  return linked?.accountId ?? null;
}

/**
 * Normaliza y valida las líneas de un asiento automático:
 * - convierte a céntimos enteros, pasa importes negativos al lado contrario y descarta líneas a cero;
 * - exige al menos dos líneas y Σdebe = Σhaber exacto en céntimos.
 */
export function normalizePostingLines(lines: PostingLine[]): NormalizedPostingLine[] {
  const normalized = lines
    .map((line) => {
      const net = toCents(line.debit) - toCents(line.credit);
      return { accountId: line.accountId, debitCents: net > 0 ? net : 0, creditCents: net < 0 ? -net : 0 };
    })
    .filter((line) => line.debitCents > 0 || line.creditCents > 0);

  if (normalized.length < 2) {
    throw new AccountingRuleError(422, "ENTRY_TOO_SHORT", "El asiento automático no contiene suficientes líneas con importe.");
  }
  const debit = sumCents(normalized.map((line) => line.debitCents));
  const credit = sumCents(normalized.map((line) => line.creditCents));
  if (debit !== credit) {
    throw new AccountingRuleError(
      422,
      "ENTRY_UNBALANCED",
      `El asiento automático está descuadrado (debe ${centsToAmount(debit)}, haber ${centsToAmount(credit)}). Revisa los importes del documento.`,
    );
  }
  return normalized.map((line) => ({
    accountId: line.accountId,
    debit: centsToAmount(line.debitCents),
    credit: centsToAmount(line.creditCents),
  }));
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
  const postingLines = normalizePostingLines(input.lines);
  const defaultJournal = await ensureDefaultJournal(input.companyId, client);
  const number = await reserveJournalEntryNumber(client, input.companyId);
  const [createdEntry] = await client
    .insert(journalEntry)
    .values({
      companyId: input.companyId,
      number,
      journalId: defaultJournal.id,
      postedAt: input.postedAt,
      reference: input.reference,
      sourceType: input.sourceType ?? input.entityName,
      sourceId: input.sourceId ?? input.entityId,
      isAutomatic: true,
    })
    .returning({ id: journalEntry.id });

  await client.insert(journalLine).values(
    postingLines.map((line) => ({
      journalEntryId: createdEntry.id,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
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
    const lines = await client.select().from(journalLine).where(eq(journalLine.journalEntryId, entry.id));
    const number = await reserveJournalEntryNumber(client, input.companyId);
    const [reversal] = await client.insert(journalEntry).values({
      companyId: input.companyId,
      number,
      journalId: entry.journalId,
      postedAt: input.postedAt,
      reference: input.reason,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      isAutomatic: true,
      reversesEntryId: entry.id,
    }).returning({ id: journalEntry.id });
    if (lines.length > 0) {
      await client.insert(journalLine).values(lines.map((line) => ({
        journalEntryId: reversal.id,
        accountId: line.accountId,
        debit: line.credit,
        credit: line.debit,
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

/** Líneas del asiento de una factura emitida (función pura). */
export function buildSalesInvoiceLines(
  accounts: { customer: string; sales: string; vatOutput: string; withholdingReceivable: string },
  amounts: { subtotal: number; taxAmount: number; totalAmount: number; retentionAmount?: number },
): PostingLine[] {
  const retention = Math.max(toCents(amounts.retentionAmount ?? 0), 0);
  const lines = [
    { accountId: accounts.customer, debitCents: toCents(amounts.totalAmount), creditCents: 0 },
    { accountId: accounts.withholdingReceivable, debitCents: retention, creditCents: 0 },
    { accountId: accounts.sales, debitCents: 0, creditCents: toCents(amounts.subtotal) },
    { accountId: accounts.vatOutput, debitCents: 0, creditCents: toCents(amounts.taxAmount) },
  ];
  return toPostingLines(absorbRoundingDifference(lines, "credit", 4));
}

/**
 * Factura emitida: 430 (total a cobrar) + 473 (retención IRPF que nos practica el cliente)
 * a 700 (base) + 477 (IVA y recargo de equivalencia repercutidos).
 */
export async function postSalesInvoice(
  input: PostingInput & { invoiceId: string; subtotal: number; taxAmount: number; totalAmount: number; retentionAmount?: number },
) {
  const client = input.dbClient ?? db;
  const hasRetention = (input.retentionAmount ?? 0) > 0;
  const roles: AccountRole[] = hasRetention ? ["customer", "sales", "vatOutput", "withholdingReceivable"] : ["customer", "sales", "vatOutput"];
  const { ids } = await resolveAccounts(input.companyId, roles, client);
  // Sin retención la línea 473 queda a cero y se descarta; se usa la cuenta de cliente como marcador.
  const lines = buildSalesInvoiceLines(
    { customer: ids.customer, sales: ids.sales, vatOutput: ids.vatOutput, withholdingReceivable: ids.withholdingReceivable ?? ids.customer },
    input,
  );

  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.salesInvoice",
    entityName: "invoice",
    entityId: input.invoiceId,
    lines,
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
  const vatTreatment = input.vatTreatment ?? (await lookupSupplierVatTreatment(client, input.companyId, input.supplierInvoiceId));
  const expenseLines = input.expenseLines && input.expenseLines.length > 0
    ? input.expenseLines
    : [{ accountId: ids.purchase, subtotal: input.subtotal, taxAmount: input.taxAmount, taxDeductiblePct: 100, retentionAmount: input.retentionAmount ?? 0 }];

  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.supplierInvoice",
    entityName: "supplierInvoice",
    entityId: input.supplierInvoiceId,
    lines: buildSupplierInvoiceLines({
      accounts: ids,
      expenseLines,
      totalAmount: input.totalAmount,
      prorrataPct: settings.prorrataPct,
      vatTreatment,
    }),
  });
}

/** Cobro de cliente: banco de la forma de pago (o 572) a 430. */
export async function postCustomerPayment(
  input: PostingInput & { paymentId: string; amount: number; paymentMethodId?: string | null; bankAccountId?: string | null },
) {
  const client = input.dbClient ?? db;
  const { ids } = await resolveAccounts(input.companyId, ["bank", "customer"], client);
  const bankId = (await resolveBankLedgerAccountId(client, input.companyId, input)) ?? ids.bank;
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.customerPayment",
    entityName: "payment",
    entityId: input.paymentId,
    lines: [
      { accountId: bankId, debit: input.amount, credit: 0 },
      { accountId: ids.customer, debit: 0, credit: input.amount },
    ],
  });
}

/** Pago a proveedor: 400/410 a banco de la cuenta o forma de pago elegida (o 572). */
export async function postSupplierPayment(
  input: PostingInput & { supplierPaymentId: string; amount: number; paymentMethodId?: string | null; bankAccountId?: string | null },
) {
  const client = input.dbClient ?? db;
  const { ids } = await resolveAccounts(input.companyId, ["bank", "supplier"], client);
  const bankId = (await resolveBankLedgerAccountId(client, input.companyId, input)) ?? ids.bank;
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.supplierPayment",
    entityName: "supplierPayment",
    entityId: input.supplierPaymentId,
    lines: [
      { accountId: ids.supplier, debit: input.amount, credit: 0 },
      { accountId: bankId, debit: 0, credit: input.amount },
    ],
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
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.bankTransaction",
    entityName: "bankTransaction",
    entityId: input.bankTransactionId,
    lines: isDeposit
      ? [
          { accountId: bankId, debit: amount, credit: 0 },
          { accountId: ids.suspense, debit: 0, credit: amount },
        ]
      : [
          { accountId: ids.suspense, debit: amount, credit: 0 },
          { accountId: bankId, debit: 0, credit: amount },
        ],
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
    { accountId: accounts.sales, net: -subtotal },
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
  input: PostingInput & { invoiceId: string; subtotal: number; taxAmount: number; totalAmount: number; retentionAmount?: number },
) {
  const client = input.dbClient ?? db;
  const hasRetention = (input.retentionAmount ?? 0) !== 0;
  const roles: AccountRole[] = hasRetention ? ["customer", "sales", "vatOutput", "withholdingReceivable"] : ["customer", "sales", "vatOutput"];
  const { ids } = await resolveAccounts(input.companyId, roles, client);
  await createAutomaticEntry({
    ...input,
    action: "accounting.autopost.creditNote",
    entityName: "invoice",
    entityId: input.invoiceId,
    lines: buildCreditNoteLines(
      { customer: ids.customer, sales: ids.sales, vatOutput: ids.vatOutput, withholdingReceivable: ids.withholdingReceivable ?? ids.customer },
      input,
    ),
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
  allocations: Array<{ accountId: string; amount: number | string }>,
): PostingLine[] {
  const direction = movementAmount >= 0 ? 1 : -1;
  const lines: PostingLine[] = [];
  let bankNetCents = 0;
  for (const allocation of allocations) {
    const cents = toCents(allocation.amount);
    bankNetCents += direction * cents;
    const accountNet = -direction * cents;
    lines.push({
      accountId: allocation.accountId,
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
    allocations: Array<{ accountId: string; amount: number | string }>;
  },
) {
  const client = input.dbClient ?? db;
  const { ids } = await resolveAccounts(input.companyId, ["bank"], client);
  const bankId = (await resolveBankLedgerAccountId(client, input.companyId, { bankAccountId: input.bankAccountId })) ?? ids.bank;
  return createAutomaticEntry({
    ...input,
    action: "accounting.autopost.bankTransactionAssignment",
    entityName: "bankTransaction",
    entityId: input.bankTransactionId,
    sourceType: "bankTransactionAssignment",
    sourceId: input.bankTransactionId,
    lines: buildBankAssignmentLines(bankId, input.movementAmount, input.allocations),
  });
}
