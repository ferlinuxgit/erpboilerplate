import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { accountChart, fiscalYear, fixedAsset, fixedAssetDepreciation, fixedAssetSettings, journalEntry, partner, supplierInvoice } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { createAutomaticEntry, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { AccountingRuleError, isAccountingRuleError } from "@/server/accounting/errors";
import { centsToAmount, toCents } from "@/server/accounting/money";
import { ensureSubaccount, toPostableAccountId } from "@/server/accounting/subaccounts";
import { recordAudit } from "@/server/audit";
import { assertFiscalPeriodOpen, resolveOpenPostingDate } from "@/server/fiscal/locks";
import {
  assetCategoryForCode,
  assetStatusFor,
  buildDisposalLines,
  buildRegisterRows,
  categoryAccounts,
  effectiveAnnualPct,
  FIXED_ASSET_DOCUMENT_TYPE,
  FIXED_ASSET_SOURCE,
  nextAssetCode,
  validateAssetRules,
  type AssetStatus,
  type DepreciationMethod,
  type RegisterRow,
} from "@/server/fixed-assets/model";
import { planAssetPostings, type PlannedPosting, type PostingBlock } from "@/server/fixed-assets/posting-plan";
import {
  addDays,
  buildDepreciationSchedule,
  dateToIso,
  formatIsoDate,
  isoToDate,
  pendingPostings,
  postingPeriods,
  type DepreciationFrequency,
  type DepreciationSchedule,
  type FiscalRange,
} from "@/server/fixed-assets/schedule";
import type { DisposeFixedAssetInput, FixedAssetInput } from "@/server/fixed-assets/schemas";
import { findTaxCoefficient } from "@/server/fixed-assets/tax-coefficients";

export type Actor = { tenantId: string; companyId: string; actorUserId: string };

type AssetRow = typeof fixedAsset.$inferSelect;
type PostingLike = { periodEnd: string; amount: string };

function notFound() {
  return new AccountingRuleError(404, "FIXED_ASSET_NOT_FOUND", "Bien de inmovilizado no encontrado.");
}

// ---------------------------------------------------------------------------------------------
// Ajustes y datos de apoyo
// ---------------------------------------------------------------------------------------------

export async function getDepreciationFrequency(companyId: string, client: DbClient = db): Promise<DepreciationFrequency> {
  const [row] = await client
    .select({ frequency: fixedAssetSettings.depreciationFrequency })
    .from(fixedAssetSettings)
    .where(eq(fixedAssetSettings.companyId, companyId))
    .limit(1);
  return row?.frequency === "monthly" ? "monthly" : "annual";
}

export async function setDepreciationFrequency(actor: Actor, frequency: DepreciationFrequency) {
  await db
    .insert(fixedAssetSettings)
    .values({ companyId: actor.companyId, depreciationFrequency: frequency })
    .onConflictDoUpdate({ target: fixedAssetSettings.companyId, set: { depreciationFrequency: frequency, updatedAt: new Date() } });
  await recordAudit({ ...actor, action: "fixedAsset.settings.update", entityName: "fixedAssetSettings", entityId: actor.companyId, payload: { depreciationFrequency: frequency } });
  return { depreciationFrequency: frequency };
}

/** Ejercicios de la empresa como rangos AAAA-MM-DD (para el cuadro de amortización). */
export async function loadFiscalRanges(companyId: string, client: DbClient = db): Promise<FiscalRange[]> {
  const years = await client
    .select({ code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt })
    .from(fiscalYear)
    .where(eq(fiscalYear.companyId, companyId))
    .orderBy(asc(fiscalYear.startsAt));
  return years.map((year) => ({ code: year.code, start: dateToIso(year.startsAt), end: dateToIso(year.endsAt) }));
}

/** Cuentas que se ofrecen en la ficha: inmovilizado (20-22), amortización acumulada (28) y dotación (68). */
export async function listFixedAssetAccountOptions(companyId: string) {
  const rows = await db
    .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name, isBlocked: accountChart.isBlocked })
    .from(accountChart)
    .where(eq(accountChart.companyId, companyId))
    .orderBy(asc(accountChart.code));
  const usable = rows.filter((row) => !row.isBlocked && row.code.length >= 3).map(({ id, code, name }) => ({ id, code, name }));
  return {
    asset: usable.filter((row) => assetCategoryForCode(row.code) !== null),
    accumulated: usable.filter((row) => row.code.startsWith("28")),
    expense: usable.filter((row) => row.code.startsWith("68")),
  };
}

/** Facturas de proveedor recientes para enlazar el bien con su factura de origen (solo lectura). */
export async function listSupplierInvoiceOptions(companyId: string, limit = 300) {
  const rows = await db
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      issueDate: supplierInvoice.issueDate,
      totalAmount: supplierInvoice.totalAmount,
      supplierName: partner.name,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(eq(supplierInvoice.companyId, companyId), ne(supplierInvoice.status, "VOID")))
    .orderBy(desc(supplierInvoice.issueDate))
    .limit(limit);
  return rows.map((row) => ({ ...row, issueDate: dateToIso(row.issueDate) }));
}

// ---------------------------------------------------------------------------------------------
// Cifras de un bien
// ---------------------------------------------------------------------------------------------

export type AssetFigures = {
  costCents: number;
  residualCents: number;
  depreciableCents: number;
  priorCents: number;
  /** Dotaciones contabilizadas por el programa. */
  postedCents: number;
  /** Amortización acumulada: la anterior al programa más la contabilizada. */
  accumulatedCents: number;
  netBookValueCents: number;
  /** Lo que queda por amortizar (valor amortizable − acumulada). */
  remainingCents: number;
  /** Último día con la dotación contabilizada. */
  postedThrough: string | null;
  annualPct: number | null;
  schedule: DepreciationSchedule | null;
};

function assetFigures(asset: AssetRow, postings: readonly PostingLike[], fiscalYears: readonly FiscalRange[], endDate: string | null = asset.disposalDate): AssetFigures {
  const costCents = toCents(asset.acquisitionCost);
  const residualCents = toCents(asset.residualValue);
  const depreciableCents = asset.isDepreciable ? costCents - residualCents : 0;
  const priorCents = toCents(asset.priorAccumulated);
  const postedCents = postings.reduce((sum, posting) => sum + toCents(posting.amount), 0);
  const accumulatedCents = priorCents + postedCents;
  const postedThrough = postings.reduce<string | null>((latest, posting) => (latest === null || posting.periodEnd > latest ? posting.periodEnd : latest), null);
  const annualPct = asset.isDepreciable
    ? effectiveAnnualPct({
        method: asset.method as DepreciationMethod,
        annualPct: asset.annualPct === null ? null : Number(asset.annualPct),
        usefulLifeYears: asset.usefulLifeYears === null ? null : Number(asset.usefulLifeYears),
      })
    : null;
  const schedule = annualPct
    ? buildDepreciationSchedule({
        depreciableCents,
        annualPct,
        startDate: asset.depreciationStartDate ?? asset.inServiceDate,
        endDate,
        priorAccumulatedCents: priorCents,
        fiscalYears,
      })
    : null;
  return {
    costCents,
    residualCents,
    depreciableCents,
    priorCents,
    postedCents,
    accumulatedCents,
    netBookValueCents: costCents - accumulatedCents,
    remainingCents: Math.max(0, depreciableCents - accumulatedCents),
    postedThrough,
    annualPct,
    schedule,
  };
}

function pendingFor(figures: AssetFigures, frequency: DepreciationFrequency, until: string) {
  if (!figures.schedule) return [];
  return pendingPostings(postingPeriods(figures.schedule, frequency), { postedThrough: figures.postedThrough, postedCents: figures.accumulatedCents, until });
}

function groupPostings<T extends { assetId: string }>(rows: readonly T[]) {
  const byAsset = new Map<string, T[]>();
  for (const row of rows) {
    const list = byAsset.get(row.assetId);
    if (list) list.push(row);
    else byAsset.set(row.assetId, [row]);
  }
  return byAsset;
}

async function loadPostings(client: DbClient, companyId: string, assetIds?: string[]) {
  if (assetIds && assetIds.length === 0) return [];
  return client
    .select({
      id: fixedAssetDepreciation.id,
      assetId: fixedAssetDepreciation.assetId,
      periodStart: fixedAssetDepreciation.periodStart,
      periodEnd: fixedAssetDepreciation.periodEnd,
      amount: fixedAssetDepreciation.amount,
      journalEntryId: fixedAssetDepreciation.journalEntryId,
    })
    .from(fixedAssetDepreciation)
    .where(and(eq(fixedAssetDepreciation.companyId, companyId), assetIds ? inArray(fixedAssetDepreciation.assetId, assetIds) : undefined))
    .orderBy(asc(fixedAssetDepreciation.periodEnd));
}

// ---------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------

export type FixedAssetListRow = {
  id: string;
  code: string;
  description: string;
  assetAccountCode: string;
  acquisitionDate: string;
  inServiceDate: string;
  status: AssetStatus;
  isDepreciable: boolean;
  annualPct: number | null;
  costCents: number;
  accumulatedCents: number;
  /** Pendiente de amortizar. */
  remainingCents: number;
  netBookValueCents: number;
  /** Dotaciones vencidas hasta `today` que aún no están contabilizadas. */
  unpostedCents: number;
  disposalDate: string | null;
};

export async function listFixedAssets(companyId: string, today: string): Promise<FixedAssetListRow[]> {
  const [assets, postings, fiscalYears, frequency] = await Promise.all([
    db
      .select({ asset: fixedAsset, assetAccountCode: accountChart.code })
      .from(fixedAsset)
      .innerJoin(accountChart, eq(accountChart.id, fixedAsset.assetAccountId))
      .where(eq(fixedAsset.companyId, companyId))
      .orderBy(asc(fixedAsset.code)),
    loadPostings(db, companyId),
    loadFiscalRanges(companyId),
    getDepreciationFrequency(companyId),
  ]);
  const byAsset = groupPostings(postings);
  return assets.map(({ asset, assetAccountCode }) => {
    const figures = assetFigures(asset, byAsset.get(asset.id) ?? [], fiscalYears);
    const unpostedCents = asset.status === "active" ? pendingFor(figures, frequency, today).reduce((sum, period) => sum + period.amountCents, 0) : 0;
    return {
      id: asset.id,
      code: asset.code,
      description: asset.description,
      assetAccountCode,
      acquisitionDate: asset.acquisitionDate,
      inServiceDate: asset.inServiceDate,
      status: asset.status as AssetStatus,
      isDepreciable: asset.isDepreciable,
      annualPct: figures.annualPct,
      costCents: figures.costCents,
      accumulatedCents: figures.accumulatedCents,
      remainingCents: asset.status === "disposed" ? 0 : figures.remainingCents,
      netBookValueCents: asset.status === "disposed" ? 0 : figures.netBookValueCents,
      unpostedCents,
      disposalDate: asset.disposalDate,
    };
  });
}

export async function getFixedAsset(companyId: string, id: string) {
  const assetAccount = alias(accountChart, "asset_account");
  const accumulatedAccount = alias(accountChart, "accumulated_account");
  const expenseAccount = alias(accountChart, "expense_account");
  const disposalAccount = alias(accountChart, "disposal_account");
  const [row] = await db
    .select({
      asset: fixedAsset,
      assetAccount: { id: assetAccount.id, code: assetAccount.code, name: assetAccount.name },
      accumulatedAccount: { id: accumulatedAccount.id, code: accumulatedAccount.code, name: accumulatedAccount.name },
      expenseAccount: { id: expenseAccount.id, code: expenseAccount.code, name: expenseAccount.name },
      disposalAccount: { id: disposalAccount.id, code: disposalAccount.code, name: disposalAccount.name },
      supplierInvoice: { id: supplierInvoice.id, number: supplierInvoice.number, supplierDocumentNumber: supplierInvoice.supplierDocumentNumber },
    })
    .from(fixedAsset)
    .innerJoin(assetAccount, eq(assetAccount.id, fixedAsset.assetAccountId))
    .leftJoin(accumulatedAccount, eq(accumulatedAccount.id, fixedAsset.accumulatedAccountId))
    .leftJoin(expenseAccount, eq(expenseAccount.id, fixedAsset.expenseAccountId))
    .leftJoin(disposalAccount, eq(disposalAccount.id, fixedAsset.disposalAccountId))
    .leftJoin(supplierInvoice, and(eq(supplierInvoice.id, fixedAsset.supplierInvoiceId), eq(supplierInvoice.companyId, companyId)))
    .where(and(eq(fixedAsset.companyId, companyId), eq(fixedAsset.id, id)))
    .limit(1);
  if (!row) return null;

  const [postings, disposalEntries, fiscalYears, frequency] = await Promise.all([
    db
      .select({
        id: fixedAssetDepreciation.id,
        periodStart: fixedAssetDepreciation.periodStart,
        periodEnd: fixedAssetDepreciation.periodEnd,
        amount: fixedAssetDepreciation.amount,
        journalEntryId: fixedAssetDepreciation.journalEntryId,
        entryNumber: journalEntry.number,
      })
      .from(fixedAssetDepreciation)
      .innerJoin(journalEntry, eq(journalEntry.id, fixedAssetDepreciation.journalEntryId))
      .where(and(eq(fixedAssetDepreciation.companyId, companyId), eq(fixedAssetDepreciation.assetId, id)))
      .orderBy(asc(fixedAssetDepreciation.periodEnd)),
    db
      .select({ id: journalEntry.id, number: journalEntry.number, postedAt: journalEntry.postedAt, reference: journalEntry.reference, reversedAt: journalEntry.reversedAt, reversesEntryId: journalEntry.reversesEntryId })
      .from(journalEntry)
      .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.sourceType, FIXED_ASSET_SOURCE.disposal), eq(journalEntry.sourceId, id)))
      .orderBy(asc(journalEntry.postedAt), asc(journalEntry.number)),
    loadFiscalRanges(companyId),
    getDepreciationFrequency(companyId),
  ]);

  const figures = assetFigures(row.asset, postings, fiscalYears);
  return {
    ...row,
    category: assetCategoryForCode(row.assetAccount.code),
    status: row.asset.status as AssetStatus,
    figures,
    frequency,
    postings: postings.map((posting) => ({ ...posting, amountCents: toCents(posting.amount) })),
    disposalEntries,
    taxCoefficient: findTaxCoefficient(row.asset.taxCoefficientKey),
    /** Con dotaciones contabilizadas o de baja no se pueden cambiar importes, fechas ni cuentas. */
    economicsLocked: postings.length > 0 || row.asset.status === "disposed",
  };
}

export type FixedAssetDetail = NonNullable<Awaited<ReturnType<typeof getFixedAsset>>>;

// ---------------------------------------------------------------------------------------------
// Alta, edición y borrado
// ---------------------------------------------------------------------------------------------

type ResolvedAssetValues = {
  description: string;
  notes: string | null;
  assetAccountId: string;
  accumulatedAccountId: string | null;
  expenseAccountId: string | null;
  acquisitionDate: string;
  inServiceDate: string;
  acquisitionCost: string;
  residualValue: string;
  isDepreciable: boolean;
  method: DepreciationMethod;
  annualPct: string | null;
  usefulLifeYears: string | null;
  taxCoefficientKey: string | null;
  depreciationStartDate: string | null;
  priorAccumulated: string;
  supplierInvoiceId: string | null;
};

const ECONOMIC_KEYS = [
  "assetAccountId",
  "accumulatedAccountId",
  "expenseAccountId",
  "acquisitionDate",
  "inServiceDate",
  "acquisitionCost",
  "residualValue",
  "isDepreciable",
  "method",
  "annualPct",
  "usefulLifeYears",
  "depreciationStartDate",
  "priorAccumulated",
] as const satisfies ReadonlyArray<keyof ResolvedAssetValues>;

function sameEconomicValue(key: (typeof ECONOMIC_KEYS)[number], current: AssetRow, next: ResolvedAssetValues) {
  const left = current[key];
  const right = next[key];
  if (key === "acquisitionCost" || key === "residualValue" || key === "priorAccumulated") return toCents(left as string) === toCents(right as string);
  if (key === "annualPct" || key === "usefulLifeYears") {
    // Solo cuenta el dato del método en uso.
    const active = next.method === "percent" ? "annualPct" : "usefulLifeYears";
    if (key !== active || !next.isDepreciable) return true;
    return left !== null && right !== null && Math.abs(Number(left) - Number(right)) < 1e-6;
  }
  if (key === "depreciationStartDate") return (left ?? null) === (right ?? null);
  return left === right;
}

async function resolveAssetValues(client: DbClient, companyId: string, input: FixedAssetInput): Promise<ResolvedAssetValues> {
  const acquisitionCostCents = toCents(input.acquisitionCost);
  const residualValueCents = toCents(input.residualValue ?? 0);
  const priorAccumulatedCents = input.isDepreciable ? toCents(input.priorAccumulated ?? 0) : 0;
  const depreciationStartDate = input.isDepreciable ? input.depreciationStartDate || null : null;
  const ruleError = validateAssetRules({
    assetAccountCode: input.assetAccountCode,
    accumulatedAccountCode: input.accumulatedAccountCode,
    expenseAccountCode: input.expenseAccountCode,
    isDepreciable: input.isDepreciable,
    method: input.method,
    annualPct: input.annualPct,
    usefulLifeYears: input.usefulLifeYears,
    acquisitionDate: input.acquisitionDate,
    inServiceDate: input.inServiceDate,
    depreciationStartDate,
    acquisitionCostCents,
    residualValueCents,
    priorAccumulatedCents,
  });
  if (ruleError) throw new AccountingRuleError(422, "FIXED_ASSET_INVALID", ruleError);
  if (input.taxCoefficientKey && !findTaxCoefficient(input.taxCoefficientKey)) {
    throw new AccountingRuleError(422, "FIXED_ASSET_INVALID", "El tipo de elemento de la tabla fiscal no existe.");
  }

  let supplierInvoiceId: string | null = null;
  if (input.supplierInvoiceId) {
    const [invoiceRow] = await client
      .select({ id: supplierInvoice.id })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.id, input.supplierInvoiceId)))
      .limit(1);
    if (!invoiceRow) throw new AccountingRuleError(422, "FIXED_ASSET_INVALID", "La factura de proveedor indicada no existe en esta empresa.");
    supplierInvoiceId = invoiceRow.id;
  }

  const assetAccount = await ensureSubaccount(companyId, input.assetAccountCode, client);
  const accumulatedAccount = input.isDepreciable && input.accumulatedAccountCode ? await ensureSubaccount(companyId, input.accumulatedAccountCode, client) : null;
  const expenseAccount = input.isDepreciable && input.expenseAccountCode ? await ensureSubaccount(companyId, input.expenseAccountCode, client) : null;

  return {
    description: input.description,
    notes: input.notes?.trim() || null,
    assetAccountId: assetAccount.id,
    accumulatedAccountId: accumulatedAccount?.id ?? null,
    expenseAccountId: expenseAccount?.id ?? null,
    acquisitionDate: input.acquisitionDate,
    inServiceDate: input.inServiceDate,
    acquisitionCost: centsToAmount(acquisitionCostCents),
    residualValue: centsToAmount(residualValueCents),
    isDepreciable: input.isDepreciable,
    method: input.method,
    annualPct: input.isDepreciable && input.method === "percent" && input.annualPct ? String(input.annualPct) : null,
    usefulLifeYears: input.isDepreciable && input.method === "years" && input.usefulLifeYears ? String(input.usefulLifeYears) : null,
    taxCoefficientKey: input.isDepreciable ? input.taxCoefficientKey || null : null,
    depreciationStartDate,
    priorAccumulated: centsToAmount(priorAccumulatedCents),
    supplierInvoiceId,
  };
}

export async function createFixedAsset(actor: Actor, input: FixedAssetInput) {
  return db.transaction(async (tx) => {
    const values = await resolveAssetValues(tx, actor.companyId, input);
    const codes = await tx.select({ code: fixedAsset.code }).from(fixedAsset).where(eq(fixedAsset.companyId, actor.companyId));
    const status = assetStatusFor({
      disposed: false,
      isDepreciable: values.isDepreciable,
      depreciableCents: toCents(values.acquisitionCost) - toCents(values.residualValue),
      accumulatedCents: toCents(values.priorAccumulated),
    });
    const [created] = await tx
      .insert(fixedAsset)
      .values({ ...values, companyId: actor.companyId, code: nextAssetCode(codes.map((row) => row.code)), status })
      .returning({ id: fixedAsset.id, code: fixedAsset.code });
    await recordAudit({ ...actor, action: "fixedAsset.create", entityName: "fixedAsset", entityId: created.id, payload: { code: created.code, ...values } }, tx);
    return created;
  });
}

export async function updateFixedAsset(actor: Actor, id: string, input: FixedAssetInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(fixedAsset)
      .where(and(eq(fixedAsset.companyId, actor.companyId), eq(fixedAsset.id, id)))
      .limit(1)
      .for("update");
    if (!current) throw notFound();
    const postings = await loadPostings(tx, actor.companyId, [id]);
    const values = await resolveAssetValues(tx, actor.companyId, input);
    const locked = postings.length > 0 || current.status === "disposed";
    if (locked && ECONOMIC_KEYS.some((key) => !sameEconomicValue(key, current, values))) {
      throw new AccountingRuleError(
        409,
        "FIXED_ASSET_LOCKED",
        current.status === "disposed"
          ? "El bien está dado de baja: solo se pueden cambiar la descripción, las notas y la factura de origen. Anula la baja para cambiar el resto."
          : "El bien ya tiene amortizaciones contabilizadas: solo se pueden cambiar la descripción, las notas y la factura de origen. Deshaz las amortizaciones para cambiar importes, fechas, porcentaje o cuentas.",
      );
    }
    const editable = locked
      ? { description: values.description, notes: values.notes, supplierInvoiceId: values.supplierInvoiceId, taxCoefficientKey: values.taxCoefficientKey }
      : {
          ...values,
          status: assetStatusFor({
            disposed: false,
            isDepreciable: values.isDepreciable,
            depreciableCents: toCents(values.acquisitionCost) - toCents(values.residualValue),
            accumulatedCents: toCents(values.priorAccumulated),
          }),
        };
    await tx.update(fixedAsset).set({ ...editable, updatedAt: new Date() }).where(eq(fixedAsset.id, id));
    await recordAudit({ ...actor, action: "fixedAsset.update", entityName: "fixedAsset", entityId: id, payload: editable }, tx);
    return { id, code: current.code };
  });
}

export async function deleteFixedAsset(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: fixedAsset.id, code: fixedAsset.code, status: fixedAsset.status })
      .from(fixedAsset)
      .where(and(eq(fixedAsset.companyId, actor.companyId), eq(fixedAsset.id, id)))
      .limit(1)
      .for("update");
    if (!current) throw notFound();
    const postings = await loadPostings(tx, actor.companyId, [id]);
    if (postings.length > 0 || current.status === "disposed") {
      throw new AccountingRuleError(409, "FIXED_ASSET_LOCKED", "No se puede eliminar un bien con amortizaciones contabilizadas o dado de baja. Deshaz antes sus asientos.");
    }
    await tx.delete(fixedAsset).where(eq(fixedAsset.id, id));
    await recordAudit({ ...actor, action: "fixedAsset.delete", entityName: "fixedAsset", entityId: id, payload: { code: current.code } }, tx);
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Contabilizar amortizaciones
// ---------------------------------------------------------------------------------------------

/** Comprueba (con caché por fecha) si una fecha admite apuntes: ejercicio abierto y periodo fiscal sin presentar. */
function openDateChecker(companyId: string, client: DbClient) {
  const cache = new Map<string, Promise<PostingBlock | null>>();
  return (iso: string) => {
    let pending = cache.get(iso);
    if (!pending) {
      pending = assertFiscalPeriodOpen(companyId, isoToDate(iso), client).then(
        () => null,
        (error: unknown) => {
          if (isAccountingRuleError(error)) return { code: error.code, message: error.message };
          throw error;
        },
      );
      cache.set(iso, pending);
    }
    return pending;
  };
}

type DepreciableAsset = AssetRow & { accumulatedAccountId: string; expenseAccountId: string };

function isDepreciableAsset(asset: AssetRow): asset is DepreciableAsset {
  return asset.isDepreciable && asset.accumulatedAccountId !== null && asset.expenseAccountId !== null;
}

async function postDepreciationEntry(tx: DbClient, actor: Actor, asset: DepreciableAsset, posting: Pick<PlannedPosting, "start" | "end" | "amountCents" | "label">) {
  const id = crypto.randomUUID();
  const amount = centsToAmount(posting.amountCents);
  const meta = {
    concept: `Amortización ${posting.label} · ${asset.description}`.slice(0, 200),
    documentType: FIXED_ASSET_DOCUMENT_TYPE,
    documentNumber: asset.code,
    documentId: asset.id,
  };
  const entry = await createAutomaticEntry({
    ...actor,
    dbClient: tx,
    postedAt: isoToDate(posting.end),
    reference: `Amortización ${asset.code} · ${posting.label}`.slice(0, 200),
    lines: [
      { accountId: asset.expenseAccountId, debit: amount, credit: 0, ...meta },
      { accountId: asset.accumulatedAccountId, debit: 0, credit: amount, ...meta },
    ],
    action: "fixedAsset.depreciation.post",
    entityName: FIXED_ASSET_SOURCE.depreciation,
    entityId: id,
    sourceType: FIXED_ASSET_SOURCE.depreciation,
    sourceId: id,
  });
  await tx.insert(fixedAssetDepreciation).values({
    id,
    companyId: actor.companyId,
    assetId: asset.id,
    periodStart: posting.start,
    periodEnd: posting.end,
    amount,
    journalEntryId: entry.id,
  });
  return entry;
}

export type DepreciationRunRow = {
  assetId: string;
  code: string;
  description: string;
  /** Asientos que se generan (o se han generado) y su importe total. */
  entries: number;
  amountCents: number;
  /** Importe que no se puede contabilizar y el motivo. */
  blockedCents: number;
  blockedReason: string | null;
};

export type DepreciationRun = {
  until: string;
  frequency: DepreciationFrequency;
  rows: DepreciationRunRow[];
  entries: number;
  amountCents: number;
  blockedCents: number;
};

async function runDepreciation(client: DbClient, actor: Actor | null, companyId: string, input: { until: string; assetId?: string }, lockRows: boolean): Promise<DepreciationRun> {
  const frequency = await getDepreciationFrequency(companyId, client);
  const where = and(
    eq(fixedAsset.companyId, companyId),
    eq(fixedAsset.status, "active"),
    eq(fixedAsset.isDepreciable, true),
    input.assetId ? eq(fixedAsset.id, input.assetId) : undefined,
  );
  const assetQuery = client.select().from(fixedAsset).where(where).orderBy(asc(fixedAsset.code));
  const assets = lockRows ? await assetQuery.for("update") : await assetQuery;
  const [postings, fiscalYears] = await Promise.all([
    loadPostings(client, companyId, assets.map((asset) => asset.id)),
    loadFiscalRanges(companyId, client),
  ]);
  const byAsset = groupPostings(postings);
  const checkOpen = openDateChecker(companyId, client);

  const rows: DepreciationRunRow[] = [];
  for (const asset of assets) {
    if (!isDepreciableAsset(asset)) continue;
    const figures = assetFigures(asset, byAsset.get(asset.id) ?? [], fiscalYears);
    const pending = pendingFor(figures, frequency, input.until);
    if (pending.length === 0) continue;
    const plan = await planAssetPostings(pending, checkOpen);
    const amountCents = plan.postings.reduce((sum, posting) => sum + posting.amountCents, 0);
    if (actor) {
      for (const posting of plan.postings) await postDepreciationEntry(client, actor, asset, posting);
      if (amountCents > 0) {
        const status = assetStatusFor({ disposed: false, isDepreciable: true, depreciableCents: figures.depreciableCents, accumulatedCents: figures.accumulatedCents + amountCents });
        if (status !== asset.status) await client.update(fixedAsset).set({ status, updatedAt: new Date() }).where(eq(fixedAsset.id, asset.id));
      }
    }
    rows.push({
      assetId: asset.id,
      code: asset.code,
      description: asset.description,
      entries: plan.postings.length,
      amountCents,
      blockedCents: plan.blocked?.amountCents ?? 0,
      blockedReason: plan.blocked?.reason ?? null,
    });
  }
  return {
    until: input.until,
    frequency,
    rows,
    entries: rows.reduce((sum, row) => sum + row.entries, 0),
    amountCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    blockedCents: rows.reduce((sum, row) => sum + row.blockedCents, 0),
  };
}

/** Qué se contabilizaría hasta `until` (solo lectura). */
export function previewDepreciation(companyId: string, input: { until: string; assetId?: string }) {
  return runDepreciation(db, null, companyId, input, false);
}

/**
 * Genera los asientos de dotación pendientes hasta `until` (68x al debe, 28x al haber, diario
 * general), uno por bien y periodo. Idempotente: cada periodo de cada bien queda registrado en
 * `fixed_asset_depreciation` y no se vuelve a contabilizar.
 */
export function postDepreciation(actor: Actor, input: { until: string; assetId?: string }) {
  return db.transaction((tx) => runDepreciation(tx, actor, actor.companyId, input, true));
}

/** Deshace la última dotación contabilizada de un bien con un contraasiento. */
export async function undoLastDepreciation(actor: Actor, assetId: string, today: string) {
  return db.transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(fixedAsset)
      .where(and(eq(fixedAsset.companyId, actor.companyId), eq(fixedAsset.id, assetId)))
      .limit(1)
      .for("update");
    if (!asset) throw notFound();
    if (asset.status === "disposed") {
      throw new AccountingRuleError(409, "FIXED_ASSET_DISPOSED", "El bien está dado de baja. Anula la baja antes de deshacer sus amortizaciones.");
    }
    const [last] = await tx
      .select()
      .from(fixedAssetDepreciation)
      .where(and(eq(fixedAssetDepreciation.companyId, actor.companyId), eq(fixedAssetDepreciation.assetId, assetId)))
      .orderBy(desc(fixedAssetDepreciation.periodEnd))
      .limit(1);
    if (!last) throw new AccountingRuleError(409, "FIXED_ASSET_NO_DEPRECIATION", "Este bien no tiene amortizaciones contabilizadas.");

    const postedAt = await resolveOpenPostingDate(actor.companyId, isoToDate(last.periodEnd), isoToDate(today), tx);
    const reason = `Anulación de la amortización ${asset.code} hasta ${formatIsoDate(last.periodEnd)}`;
    await reverseAutomaticEntries({ ...actor, dbClient: tx, postedAt, reference: reason, reason, sourceType: FIXED_ASSET_SOURCE.depreciation, sourceId: last.id });
    await tx.delete(fixedAssetDepreciation).where(eq(fixedAssetDepreciation.id, last.id));

    const remaining = await loadPostings(tx, actor.companyId, [assetId]);
    const figures = assetFigures(asset, remaining, []);
    const status = assetStatusFor({ disposed: false, isDepreciable: asset.isDepreciable, depreciableCents: figures.depreciableCents, accumulatedCents: figures.accumulatedCents });
    await tx.update(fixedAsset).set({ status, updatedAt: new Date() }).where(eq(fixedAsset.id, assetId));
    return { id: assetId, periodEnd: last.periodEnd, amountCents: toCents(last.amount), reversedAt: dateToIso(postedAt) };
  });
}

// ---------------------------------------------------------------------------------------------
// Baja o venta
// ---------------------------------------------------------------------------------------------

/**
 * Baja o venta: amortiza hasta la fecha de baja y da de baja el valor del bien y su amortización
 * acumulada contra la cuenta indicada, llevando la diferencia a pérdidas (67x) o beneficios (77x).
 * No contabiliza el IVA de la venta: si hay factura, el IVA va por el circuito de facturación.
 */
export async function disposeFixedAsset(actor: Actor, id: string, input: DisposeFixedAssetInput) {
  return db.transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(fixedAsset)
      .where(and(eq(fixedAsset.companyId, actor.companyId), eq(fixedAsset.id, id)))
      .limit(1)
      .for("update");
    if (!asset) throw notFound();
    if (asset.status === "disposed") throw new AccountingRuleError(409, "FIXED_ASSET_DISPOSED", "El bien ya está dado de baja.");
    if (input.date < asset.acquisitionDate) throw new AccountingRuleError(422, "FIXED_ASSET_INVALID", "La fecha de baja no puede ser anterior a la de adquisición.");

    const proceedsCents = input.type === "sale" ? toCents(input.proceeds ?? 0) : 0;
    if (input.type === "sale" && proceedsCents <= 0) throw new AccountingRuleError(422, "FIXED_ASSET_INVALID", "Indica el importe de la venta (sin impuestos). Si no se cobra nada, registra una baja.");
    if (proceedsCents > 0 && !input.accountId) throw new AccountingRuleError(422, "FIXED_ASSET_INVALID", "Indica la cuenta de contrapartida de la venta (banco, deudor o créditos por enajenación de inmovilizado).");

    await assertFiscalPeriodOpen(actor.companyId, isoToDate(input.date), tx);

    const [postings, fiscalYears] = await Promise.all([loadPostings(tx, actor.companyId, [id]), loadFiscalRanges(actor.companyId, tx)]);
    const figures = assetFigures(asset, postings, fiscalYears, input.date);
    if (figures.postedThrough && figures.postedThrough > input.date) {
      throw new AccountingRuleError(
        409,
        "FIXED_ASSET_DEPRECIATED_AFTER",
        `El bien tiene amortizaciones contabilizadas hasta el ${formatIsoDate(figures.postedThrough)}, posterior a la fecha de baja. Deshaz esas amortizaciones o usa una fecha de baja posterior.`,
      );
    }

    // Amortización hasta la fecha de baja. Lo pendiente de ejercicios anteriores debe contabilizarse antes.
    let accumulatedCents = figures.accumulatedCents;
    if (figures.schedule && isDepreciableAsset(asset)) {
      const disposalFiscalYear = fiscalYears.find((range) => range.start <= input.date && input.date <= range.end);
      const earlier = disposalFiscalYear
        ? pendingPostings(postingPeriods(figures.schedule, "annual"), {
            postedThrough: figures.postedThrough,
            postedCents: figures.accumulatedCents,
            until: addDays(disposalFiscalYear.start, -1),
          })
        : [];
      if (earlier.length > 0) {
        throw new AccountingRuleError(
          409,
          "FIXED_ASSET_PENDING_DEPRECIATION",
          "El bien tiene amortizaciones de ejercicios anteriores sin contabilizar. Contabilízalas (o indica en la ficha la amortización acumulada anterior) antes de darlo de baja.",
        );
      }
      const catchUpCents = figures.schedule.totalCents - figures.accumulatedCents;
      if (catchUpCents > 0 && figures.postedThrough !== input.date) {
        const firstDay = asset.depreciationStartDate ?? asset.inServiceDate;
        const yearStart = disposalFiscalYear && disposalFiscalYear.start > firstDay ? disposalFiscalYear.start : firstDay;
        const start = figures.postedThrough ? addDays(figures.postedThrough, 1) : yearStart;
        await postDepreciationEntry(tx, actor, asset, { start, end: input.date, amountCents: catchUpCents, label: `hasta la baja del ${formatIsoDate(input.date)}` });
        accumulatedCents += catchUpCents;
      }
    }

    const category = assetCategoryForCode((await tx.select({ code: accountChart.code }).from(accountChart).where(eq(accountChart.id, asset.assetAccountId)).limit(1))[0]?.code ?? "");
    if (!category) throw new AccountingRuleError(422, "FIXED_ASSET_INVALID", "La cuenta del bien no es de inmovilizado.");
    const { lines, resultCents } = buildDisposalLines({ costCents: figures.costCents, accumulatedCents, proceedsCents });
    const resultAccounts = categoryAccounts(category);
    const counterAccountId = proceedsCents > 0 && input.accountId ? await toPostableAccountId(actor.companyId, input.accountId, tx) : null;
    const label = input.type === "sale" ? "Venta" : "Baja";
    const meta = {
      concept: `${label} ${asset.code} · ${asset.description}`.slice(0, 200),
      documentType: FIXED_ASSET_DOCUMENT_TYPE,
      documentNumber: asset.code,
      documentId: asset.id,
    };
    const postingLines = [];
    for (const line of lines) {
      let accountId: string | null;
      if (line.role === "asset") accountId = asset.assetAccountId;
      else if (line.role === "accumulated") accountId = asset.accumulatedAccountId;
      else if (line.role === "proceeds") accountId = counterAccountId;
      else accountId = (await ensureSubaccount(actor.companyId, line.role === "loss" ? resultAccounts.loss : resultAccounts.gain, tx)).id;
      if (!accountId) throw new AccountingRuleError(422, "FIXED_ASSET_INVALID", "Falta una cuenta para contabilizar la baja del bien.");
      postingLines.push({ accountId, debit: centsToAmount(line.debitCents), credit: centsToAmount(line.creditCents), ...meta });
    }
    const entry = await createAutomaticEntry({
      ...actor,
      dbClient: tx,
      postedAt: isoToDate(input.date),
      reference: `${label} de inmovilizado ${asset.code}`,
      lines: postingLines,
      action: "fixedAsset.dispose",
      entityName: "fixedAsset",
      entityId: asset.id,
      sourceType: FIXED_ASSET_SOURCE.disposal,
      sourceId: asset.id,
    });
    await tx
      .update(fixedAsset)
      .set({
        status: "disposed",
        disposalDate: input.date,
        disposalType: input.type,
        disposalProceeds: centsToAmount(proceedsCents),
        disposalAccountId: counterAccountId,
        disposalNotes: input.notes?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(fixedAsset.id, id));
    return { id, entryId: entry.id, entryNumber: entry.number, resultCents };
  });
}

/** Anula la baja con un contraasiento. La amortización contabilizada hasta la fecha de baja se conserva. */
export async function undoDisposal(actor: Actor, id: string, today: string) {
  return db.transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(fixedAsset)
      .where(and(eq(fixedAsset.companyId, actor.companyId), eq(fixedAsset.id, id)))
      .limit(1)
      .for("update");
    if (!asset) throw notFound();
    if (asset.status !== "disposed" || !asset.disposalDate) throw new AccountingRuleError(409, "FIXED_ASSET_NOT_DISPOSED", "El bien no está dado de baja.");

    const postedAt = await resolveOpenPostingDate(actor.companyId, isoToDate(asset.disposalDate), isoToDate(today), tx);
    const reason = `Anulación de la baja de inmovilizado ${asset.code}`;
    await reverseAutomaticEntries({ ...actor, dbClient: tx, postedAt, reference: reason, reason, sourceType: FIXED_ASSET_SOURCE.disposal, sourceId: asset.id });

    const postings = await loadPostings(tx, actor.companyId, [id]);
    const figures = assetFigures(asset, postings, [], null);
    const status = assetStatusFor({ disposed: false, isDepreciable: asset.isDepreciable, depreciableCents: figures.depreciableCents, accumulatedCents: figures.accumulatedCents });
    await tx
      .update(fixedAsset)
      .set({ status, disposalDate: null, disposalType: null, disposalProceeds: null, disposalAccountId: null, disposalNotes: null, updatedAt: new Date() })
      .where(eq(fixedAsset.id, id));
    await recordAudit({ ...actor, action: "fixedAsset.dispose.undo", entityName: "fixedAsset", entityId: id, payload: { code: asset.code, reversedAt: dateToIso(postedAt) } }, tx);
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Cierre del ejercicio y libro registro
// ---------------------------------------------------------------------------------------------

export type DepreciationYearStatus = {
  /** Bienes registrados en la empresa (amortizables o no). */
  assets: number;
  /** Bienes con dotaciones sin contabilizar hasta el cierre del ejercicio, y su importe. */
  pendingAssets: number;
  pendingCents: number;
};

/** ¿Quedan amortizaciones sin contabilizar hasta `yearEnd` (último día del ejercicio)? */
export async function getDepreciationYearStatus(companyId: string, yearEnd: string): Promise<DepreciationYearStatus> {
  const [assets, postings, fiscalYears, frequency] = await Promise.all([
    db.select().from(fixedAsset).where(eq(fixedAsset.companyId, companyId)),
    loadPostings(db, companyId),
    loadFiscalRanges(companyId),
    getDepreciationFrequency(companyId),
  ]);
  const byAsset = groupPostings(postings);
  let pendingAssets = 0;
  let pendingCents = 0;
  for (const asset of assets) {
    if (asset.status !== "active" || !asset.isDepreciable) continue;
    const pending = pendingFor(assetFigures(asset, byAsset.get(asset.id) ?? [], fiscalYears), frequency, yearEnd).reduce((sum, period) => sum + period.amountCents, 0);
    if (pending > 0) {
      pendingAssets += 1;
      pendingCents += pending;
    }
  }
  return { assets: assets.length, pendingAssets, pendingCents };
}

export type AssetRegister = { year: { code: string; start: string; end: string }; rows: RegisterRow[] };

/** Libro registro de bienes de inversión del ejercicio indicado. */
export async function getAssetRegister(companyId: string, fiscalYearId: string): Promise<AssetRegister | null> {
  const [year] = await db
    .select({ code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.companyId, companyId), eq(fiscalYear.id, fiscalYearId)))
    .limit(1);
  if (!year) return null;
  const range = { code: year.code, start: dateToIso(year.startsAt), end: dateToIso(year.endsAt) };
  const [assets, postings] = await Promise.all([
    db
      .select({ asset: fixedAsset, assetAccountCode: accountChart.code })
      .from(fixedAsset)
      .innerJoin(accountChart, eq(accountChart.id, fixedAsset.assetAccountId))
      .where(eq(fixedAsset.companyId, companyId)),
    loadPostings(db, companyId),
  ]);
  const byAsset = groupPostings(postings);
  const rows = buildRegisterRows(
    assets.map(({ asset, assetAccountCode }) => ({
      code: asset.code,
      description: asset.description,
      assetAccountCode,
      acquisitionDate: asset.acquisitionDate,
      inServiceDate: asset.inServiceDate,
      costCents: toCents(asset.acquisitionCost),
      residualCents: toCents(asset.residualValue),
      annualPct: asset.isDepreciable
        ? effectiveAnnualPct({ method: asset.method as DepreciationMethod, annualPct: asset.annualPct === null ? null : Number(asset.annualPct), usefulLifeYears: asset.usefulLifeYears === null ? null : Number(asset.usefulLifeYears) })
        : null,
      priorAccumulatedCents: toCents(asset.priorAccumulated),
      disposalDate: asset.disposalDate,
      disposalProceedsCents: asset.disposalProceeds === null ? null : toCents(asset.disposalProceeds),
      postings: (byAsset.get(asset.id) ?? []).map((posting) => ({ periodEnd: posting.periodEnd, amountCents: toCents(posting.amount) })),
    })),
    range,
  );
  return { year: range, rows };
}
