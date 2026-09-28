import { and, asc, count, desc, eq, inArray, isNotNull, like, sql, type SQL } from "drizzle-orm";

import { accountChart, customer, journalEntry, journalLine, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { chartLevelDepth, NO_CHART_FILTERS } from "@/lib/chart-of-accounts/query";
import type {
  AccountSummary,
  ChartFiscalYearOption,
  ChartFilters,
  ChartLevel,
  ChartNode,
  ChartTreeResponse,
} from "@/lib/chart-of-accounts/types";
import {
  ancestorPrefixes,
  buildChartNode,
  buildMonthlySeries,
  distinctCodeLengths,
  nodePassesFilters,
  normalizeTaxIdQuery,
  relinkToPresentAncestors,
  type ChartAccountRow,
  type ChartFilterContext,
  type PrefixTotals,
} from "@/server/accounting/chart-tree-model";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { toCents } from "@/server/accounting/money";
import { statementPeriodOptions } from "@/server/accounting/statements-model";
import { loadChartContext } from "@/server/accounting/subaccounts";
import { expandDotShortcut, nextFreePartnerSubaccountCode, partnerAccountPrefix } from "@/server/accounting/subaccounts-model";

/**
 * Plan contable jerárquico con sumas del periodo.
 *
 * - Sumas por prefijo en SQL: primero se agrupa por cuenta y después por `left(code, n)` para cada
 *   longitud pedida, así que un grupo suma su rama entera (4 → 43 → 430 → 43000001) aunque haya
 *   miles de subcuentas de terceros.
 * - Mismo criterio que los estados financieros: el saldo inicial es todo lo anterior al periodo
 *   sin los asientos de cierre y apertura (que se compensan) y el debe/haber del periodo excluye
 *   regularización, cierre y apertura para no mezclar ejercicios.
 * - Carga perezosa: la primera petición trae los niveles 1 y 2 y cada despliegue solo los hijos
 *   directos (`parentCode`).
 */

export type ChartRange = { from: Date; toExclusive: Date };

export type ChartTreeOptions = ChartRange & {
  /** Hijos directos de esta cuenta. */
  parentCode?: string | null;
  /** Longitud de código hasta la que se despliega (null = todas las subcuentas). */
  depth?: number | null;
  q?: string | null;
  /** Además, la rama completa hasta esta cuenta (para seleccionar una subcuenta concreta). */
  reveal?: string | null;
  filters?: ChartFilters;
  matchLimit?: number;
};

const LIFECYCLE_SOURCES = ["fiscalYearRegularization", "fiscalYearClosing", "fiscalYearOpening"];
const CLOSING_OPENING_SOURCES = ["fiscalYearClosing", "fiscalYearOpening"];
const DEFAULT_MATCH_LIMIT = 200;
const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTH_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAY_MS = 86_400_000;

function sourceNotIn(values: readonly string[]) {
  return sql`coalesce(${journalEntry.sourceType}, '') not in (${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function rangeKeys(range: ChartRange) {
  return { from: dateKey(range.from), to: dateKey(new Date(range.toExclusive.getTime() - DAY_MS)) };
}

function numberFrom(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

/**
 * Sumas por prefijo (`left(code, n)` para cada longitud) del periodo y saldo inicial.
 * `scope` limita a una rama (p. ej. los hijos de 430) para que desplegar sea barato.
 */
export async function loadPrefixTotals(companyId: string, lengths: readonly number[], range: ChartRange, scope?: string | null) {
  const totals = new Map<string, PrefixTotals>();
  const safeLengths = [...new Set(lengths.map((length) => Math.trunc(length)).filter((length) => length >= 1 && length <= 64))];
  if (safeLengths.length === 0) return totals;
  const net = sql`(${journalLine.debit} - ${journalLine.credit})`;
  const inPeriod = sql`${journalEntry.postedAt} >= ${range.from} and ${sourceNotIn(LIFECYCLE_SOURCES)}`;
  const scopeFilter = scope && /^\d+$/.test(scope) ? sql`and ${accountChart.code} like ${`${scope}%`}` : sql``;
  const result = await db.execute(sql`
    with per_account as (
      select ${accountChart.code} as code,
        coalesce(sum(case when ${journalEntry.postedAt} < ${range.from} and ${sourceNotIn(CLOSING_OPENING_SOURCES)} then ${net} else 0 end), 0) as opening,
        coalesce(sum(case when ${inPeriod} then ${journalLine.debit} else 0 end), 0) as debit,
        coalesce(sum(case when ${inPeriod} then ${journalLine.credit} else 0 end), 0) as credit,
        count(case when ${inPeriod} then 1 end) as entries
      from ${journalLine}
      inner join ${journalEntry} on ${journalEntry.id} = ${journalLine.journalEntryId}
      inner join ${accountChart} on ${accountChart.id} = ${journalLine.accountId}
      where ${journalEntry.companyId} = ${companyId}
        and ${accountChart.companyId} = ${companyId}
        and ${journalEntry.postedAt} < ${range.toExclusive}
        ${scopeFilter}
      group by ${accountChart.code}
    )
    select left(per_account.code, lengths.len) as prefix,
      sum(per_account.opening) as opening,
      sum(per_account.debit) as debit,
      sum(per_account.credit) as credit,
      sum(per_account.entries) as entries
    from per_account
    cross join unnest(${sql.raw(`array[${safeLengths.join(",")}]::int[]`)}) as lengths(len)
    where length(per_account.code) >= lengths.len
    group by 1
  `);
  for (const row of result.rows) {
    totals.set(String(row.prefix), {
      openingCents: toCents(String(row.opening ?? "0")),
      debitCents: toCents(String(row.debit ?? "0")),
      creditCents: toCents(String(row.credit ?? "0")),
      entries: numberFrom(row.entries),
    });
  }
  return totals;
}

const accountColumns = {
  id: accountChart.id,
  code: accountChart.code,
  name: accountChart.name,
  type: accountChart.type,
  nature: accountChart.nature,
  parentCode: accountChart.parentCode,
  isPostable: accountChart.isPostable,
  isBlocked: accountChart.isBlocked,
  partnerId: accountChart.partnerId,
  partnerName: partner.name,
  partnerTaxId: partner.taxId,
};

async function loadAccountRows(companyId: string, condition: SQL | undefined, limit?: number): Promise<ChartAccountRow[]> {
  const query = db
    .select(accountColumns)
    .from(accountChart)
    .leftJoin(partner, eq(partner.id, accountChart.partnerId))
    .where(and(eq(accountChart.companyId, companyId), condition))
    .orderBy(asc(accountChart.code));
  return limit ? query.limit(limit) : query;
}

async function loadChildCounts(companyId: string) {
  const rows = await db
    .select({ parentCode: accountChart.parentCode, count: sql<number>`count(*)`.mapWith(Number) })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), isNotNull(accountChart.parentCode)))
    .groupBy(accountChart.parentCode);
  return new Map(rows.map((row) => [row.parentCode ?? "", row.count]));
}

async function loadFilterContext(companyId: string, filters: ChartFilters): Promise<ChartFilterContext> {
  const context = await loadChartContext(companyId);
  const base = { countryCode: context.countryCode, customerCode: context.customerCode, supplierCode: context.supplierCode };
  const partnerPrefixes = [
    partnerAccountPrefix({ ...base, role: "customer", supplierKind: "GOODS" }),
    partnerAccountPrefix({ ...base, role: "supplier", supplierKind: "GOODS" }),
    partnerAccountPrefix({ ...base, role: "supplier", supplierKind: "SERVICES" }),
  ];
  const blockedCodes = filters.blocked
    ? (await db.select({ code: accountChart.code }).from(accountChart).where(and(eq(accountChart.companyId, companyId), eq(accountChart.isBlocked, true)))).map((row) => row.code)
    : [];
  return { blockedCodes, partnerPrefixes: [...new Set(partnerPrefixes)] };
}

/** Criterio de «Ocultar saldo 0»: las subcuentas por su saldo; los grupos si su rama tiene actividad. */
function effectiveFilters(node: ChartNode, filters: ChartFilters): ChartFilters {
  return filters.nonzero && !node.isPostable ? { ...filters, nonzero: false, movements: true } : filters;
}

/** Aplica los filtros y quita la rama entera de un nodo descartado (los nodos van en orden de código). */
function filterNodes(nodes: ChartNode[], filters: ChartFilters, context: ChartFilterContext) {
  const removed = new Set<string>();
  const kept: ChartNode[] = [];
  for (const node of nodes) {
    if (node.parentCode && removed.has(node.parentCode)) {
      removed.add(node.code);
      continue;
    }
    if (!nodePassesFilters(node, effectiveFilters(node, filters), context)) {
      removed.add(node.code);
      continue;
    }
    kept.push(node);
  }
  return kept;
}

function isFiltering(filters: ChartFilters) {
  return filters.movements || filters.nonzero || filters.partners || filters.blocked;
}

async function buildNodes(companyId: string, rows: ChartAccountRow[], range: ChartRange, scope?: string | null) {
  const [totals, childCounts] = await Promise.all([
    loadPrefixTotals(companyId, distinctCodeLengths(rows.map((row) => row.code)), range, scope),
    loadChildCounts(companyId),
  ]);
  return rows.map((row) => buildChartNode(row, totals, childCounts));
}

/** Cuentas que coinciden con la búsqueda: código (o atajo del punto), nombre, tercero o NIF. */
function searchCondition(q: string, subaccountLength: number): SQL | undefined {
  const text = q.trim();
  const dotted = expandDotShortcut(text, subaccountLength);
  if (dotted) return eq(accountChart.code, dotted);
  const conditions: SQL[] = [];
  if (/^\d+$/.test(text)) conditions.push(like(accountChart.code, `${text}%`));
  const pattern = `%${escapeLike(text)}%`;
  conditions.push(sql`${accountChart.name} ilike ${pattern}`, sql`${partner.name} ilike ${pattern}`);
  const taxId = normalizeTaxIdQuery(text);
  if (taxId.length >= 3) conditions.push(sql`upper(coalesce(${partner.taxIdNormalized}, ${partner.taxId}, '')) like ${`%${escapeLike(taxId)}%`}`);
  return sql`(${sql.join(conditions, sql` or `)})`;
}

export async function getChartTree(companyId: string, options: ChartTreeOptions): Promise<ChartTreeResponse> {
  const range = { from: options.from, toExclusive: options.toExclusive };
  const filters = options.filters ?? NO_CHART_FILTERS;
  const context = await loadChartContext(companyId);
  const filterContext = isFiltering(filters) ? await loadFilterContext(companyId, filters) : { blockedCodes: [], partnerPrefixes: [] };
  const base = { range: rangeKeys(range), subaccountLength: context.subaccountLength };
  const q = options.q?.trim() ?? "";

  if (q) {
    const limit = options.matchLimit ?? DEFAULT_MATCH_LIMIT;
    const matchRows = await loadAccountRows(companyId, searchCondition(q, context.subaccountLength), limit + 1);
    const truncated = matchRows.length > limit;
    const matches = matchRows.slice(0, limit);
    const matchCodes = new Set(matches.map((row) => row.code));
    const prefixes = ancestorPrefixes(matchCodes).filter((code) => !matchCodes.has(code));
    const ancestorRows = prefixes.length > 0 ? await loadAccountRows(companyId, inArray(accountChart.code, prefixes)) : [];
    const rows = [...ancestorRows, ...matches].sort((a, b) => a.code.localeCompare(b.code));
    const nodes = relinkToPresentAncestors(await buildNodes(companyId, rows, range));
    const keptMatches = nodes.filter((node) => matchCodes.has(node.code) && nodePassesFilters(node, effectiveFilters(node, filters), filterContext));
    const neededAncestors = new Set(ancestorPrefixes(keptMatches.map((node) => node.code)));
    const keptCodes = new Set(keptMatches.map((node) => node.code));
    const result = nodes.filter((node) => keptCodes.has(node.code) || neededAncestors.has(node.code));
    return {
      ...base,
      nodes: relinkToPresentAncestors(result),
      loadedParents: ["", ...result.filter((node) => !keptCodes.has(node.code)).map((node) => node.code)],
      matchCodes: keptMatches.map((node) => node.code),
      truncated,
    };
  }

  if (options.parentCode) {
    const rows = await loadAccountRows(companyId, eq(accountChart.parentCode, options.parentCode));
    const nodes = await buildNodes(companyId, rows, range, options.parentCode);
    return { ...base, nodes: filterNodes(nodes, filters, filterContext), loadedParents: [options.parentCode], matchCodes: [], truncated: false };
  }

  const depth = options.depth === undefined ? 2 : options.depth;
  // Raíces (sin padre o con un padre que ya no existe) + hijos de las cuentas más cortas que el nivel.
  const orphan = sql`not exists (select 1 from ${accountChart} as parent_account where parent_account."companyId" = ${accountChart.companyId} and parent_account."code" = ${accountChart.parentCode})`;
  const levelCondition = depth === null ? undefined : sql`(${accountChart.parentCode} is null or length(${accountChart.parentCode}) < ${depth} or ${orphan})`;
  const reveal = options.reveal && /^\d+$/.test(options.reveal) ? options.reveal : null;
  const revealPrefixes = reveal ? ancestorPrefixes([reveal]) : [];
  const condition = reveal && levelCondition
    ? sql`(${levelCondition} or ${inArray(accountChart.parentCode, revealPrefixes)} or ${accountChart.code} = ${reveal})`
    : levelCondition;
  const rows = await loadAccountRows(companyId, condition);
  const present = new Set(rows.map((row) => row.code));
  // Un padre ausente solo puede ser una cuenta que ya no existe: la cuenta se muestra como raíz.
  const normalized = rows.map((row) => (row.parentCode && !present.has(row.parentCode) ? { ...row, parentCode: null } : row));
  const nodes = filterNodes(await buildNodes(companyId, normalized, range), filters, filterContext);
  const loadedParents = new Set<string>([""]);
  for (const node of nodes) {
    if (depth === null || node.code.length < depth) loadedParents.add(node.code);
  }
  for (const prefix of revealPrefixes) if (present.has(prefix)) loadedParents.add(prefix);
  return { ...base, nodes, loadedParents: [...loadedParents], matchCodes: [], truncated: false };
}

/** Cuentas de grupo (no admiten apuntes) para elegir la cuenta padre al crear una cuenta. */
export async function listGroupAccounts(companyId: string) {
  return db
    .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name, type: accountChart.type })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, false)))
    .orderBy(asc(accountChart.code));
}

export async function countAccounts(companyId: string) {
  const [row] = await db.select({ total: count() }).from(accountChart).where(eq(accountChart.companyId, companyId));
  return row?.total ?? 0;
}

export type ChartPeriodContext = {
  years: ChartFiscalYearOption[];
  year: ChartFiscalYearOption | null;
  range: ChartRange;
  keys: { from: string; to: string };
};

/** Ejercicio y periodo pedidos (por defecto, el ejercicio activo completo) y opciones del selector. */
export async function resolveChartPeriod(
  companyId: string,
  input: { fy?: string | null; from?: string | null; to?: string | null; activeFiscalYearId?: string | null },
): Promise<ChartPeriodContext> {
  const rows = await listFiscalYears(companyId);
  const years: ChartFiscalYearOption[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    isClosed: row.isClosed,
    from: dateKey(row.startsAt),
    to: dateKey(row.endsAt),
    periods: statementPeriodOptions(row).map((option) => {
      const period = resolvePeriodDates(row, option.value);
      return { key: option.value, label: option.label, from: dateKey(period.from), to: dateKey(new Date(period.toExclusive.getTime() - DAY_MS)) };
    }),
  }));
  const year = years.find((entry) => entry.id === input.fy) ?? years.find((entry) => entry.id === input.activeFiscalYearId) ?? years[years.length - 1] ?? null;
  const today = new Date();
  const fallbackFrom = year ? year.from : `${today.getUTCFullYear()}-01-01`;
  const fallbackTo = year ? year.to : `${today.getUTCFullYear()}-12-31`;
  let from = new Date(`${input.from ?? fallbackFrom}T00:00:00.000Z`);
  const to = new Date(`${input.to ?? fallbackTo}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || from > to) from = new Date(`${fallbackFrom}T00:00:00.000Z`);
  const range = { from, toExclusive: new Date(to.getTime() + DAY_MS) };
  return { years, year, range, keys: rangeKeys(range) };
}

function resolvePeriodDates(year: { startsAt: Date; endsAt: Date }, key: string) {
  const monthStart = (offset: number) => new Date(Date.UTC(year.startsAt.getUTCFullYear(), year.startsAt.getUTCMonth() + offset, 1));
  const quarter = /^q([1-4])$/.exec(key);
  if (quarter) return { from: monthStart((Number(quarter[1]) - 1) * 3), toExclusive: monthStart(Number(quarter[1]) * 3) };
  const month = /^m(\d{2})$/.exec(key);
  if (month) return { from: monthStart(Number(month[1]) - 1), toExclusive: monthStart(Number(month[1])) };
  return { from: year.startsAt, toExclusive: new Date(year.endsAt.getTime() + DAY_MS) };
}

/** Nivel del selector → opciones de `getChartTree`. */
export function levelToDepth(level: ChartLevel) {
  return chartLevelDepth(level);
}

/**
 * Siguiente subcuenta libre bajo una cuenta de grupo de al menos 3 dígitos (430 → 43000013).
 * Para una subcuenta se propone la siguiente de su cuenta padre.
 */
export async function suggestNextSubaccount(companyId: string, code: string) {
  const context = await loadChartContext(companyId);
  const [account] = await db
    .select({ code: accountChart.code, parentCode: accountChart.parentCode, isPostable: accountChart.isPostable })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, code)))
    .limit(1);
  if (!account) return null;
  const parentCode = account.isPostable || account.code.length >= context.subaccountLength ? account.parentCode : account.code;
  if (!parentCode || !/^\d+$/.test(parentCode) || parentCode.length < 3 || parentCode.length >= context.subaccountLength) return null;
  const existing = await db
    .select({ code: accountChart.code })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), like(accountChart.code, `${parentCode}%`), sql`length(${accountChart.code}) = ${context.subaccountLength}`));
  const next = nextFreePartnerSubaccountCode(parentCode, context.subaccountLength, existing.map((row) => row.code));
  return next ? { parentCode, code: next } : null;
}

function monthKeys(start: Date, count: number) {
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1));
    return { key: dateKey(date).slice(0, 7), month: date.getUTCMonth(), year: date.getUTCFullYear() };
  });
}

function monthCount(from: Date, toExclusive: Date) {
  const last = new Date(toExclusive.getTime() - DAY_MS);
  return Math.max(1, Math.min(24, (last.getUTCFullYear() - from.getUTCFullYear()) * 12 + (last.getUTCMonth() - from.getUTCMonth()) + 1));
}

/**
 * Ficha de una cuenta: ruta de grupos, tercero, sumas del periodo, evolución mensual del ejercicio
 * frente al anterior y últimos apuntes. Para una cuenta de grupo todo suma su rama.
 */
export async function getAccountSummary(companyId: string, accountId: string, period: ChartPeriodContext): Promise<AccountSummary | null> {
  const [account] = await db
    .select({ ...accountColumns, level: accountChart.level })
    .from(accountChart)
    .leftJoin(partner, eq(partner.id, accountChart.partnerId))
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, accountId)))
    .limit(1);
  if (!account) return null;
  const code = account.code;
  const branch = /^\d+$/.test(code) ? like(accountChart.code, `${code}%`) : eq(accountChart.code, code);

  const yearStart = period.year ? new Date(`${period.year.from}T00:00:00.000Z`) : period.range.from;
  const yearEndExclusive = period.year ? new Date(new Date(`${period.year.to}T00:00:00.000Z`).getTime() + DAY_MS) : period.range.toExclusive;
  const months = monthCount(yearStart, yearEndExclusive);
  const currentYear = period.year;
  const previousYear = currentYear ? period.years.filter((entry) => entry.to < currentYear.from).pop() ?? null : null;
  const previousStart = previousYear
    ? new Date(`${previousYear.from}T00:00:00.000Z`)
    : new Date(Date.UTC(yearStart.getUTCFullYear() - 1, yearStart.getUTCMonth(), 1));
  const currentKeys = monthKeys(yearStart, months);
  const previousKeys = monthKeys(previousStart, months);

  const net = sql`(${journalLine.debit} - ${journalLine.credit})`;
  const baseWhere = and(eq(journalEntry.companyId, companyId), eq(accountChart.companyId, companyId), branch);
  const [pathRows, totalsMap, openings, monthly, lastLines, children, next, customerRow] = await Promise.all([
    loadAccountRows(companyId, inArray(accountChart.code, [...ancestorPrefixes([code]), code])),
    loadPrefixTotals(companyId, [code.length], period.range, /^\d+$/.test(code) ? code : null),
    db
      .select({
        previous: sql<string>`coalesce(sum(case when ${journalEntry.postedAt} < ${previousStart} then ${net} else 0 end), 0)`,
        current: sql<string>`coalesce(sum(case when ${journalEntry.postedAt} < ${yearStart} then ${net} else 0 end), 0)`,
      })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
      .where(and(baseWhere, sql`${journalEntry.postedAt} < ${yearStart}`, sourceNotIn(CLOSING_OPENING_SOURCES))),
    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${journalEntry.postedAt} at time zone 'UTC'), 'YYYY-MM')`,
        debit: sql<string>`coalesce(sum(${journalLine.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${journalLine.credit}), 0)`,
      })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
      .where(and(baseWhere, sql`${journalEntry.postedAt} >= ${previousStart}`, sql`${journalEntry.postedAt} < ${yearEndExclusive}`, sourceNotIn(LIFECYCLE_SOURCES)))
      .groupBy(sql`1`),
    db
      .select({
        lineId: journalLine.id,
        entryId: journalEntry.id,
        number: journalEntry.number,
        postedAt: journalEntry.postedAt,
        accountId: accountChart.id,
        accountCode: accountChart.code,
        concept: journalLine.concept,
        reference: journalEntry.reference,
        documentType: journalLine.documentType,
        documentNumber: journalLine.documentNumber,
        partnerName: partner.name,
        debit: journalLine.debit,
        credit: journalLine.credit,
      })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
      .leftJoin(partner, eq(partner.id, journalLine.partnerId))
      .where(and(baseWhere, sql`${journalEntry.postedAt} < ${period.range.toExclusive}`))
      .orderBy(desc(journalEntry.postedAt), desc(journalEntry.number), desc(journalLine.lineNumber))
      .limit(5),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, companyId), eq(accountChart.parentCode, code))),
    suggestNextSubaccount(companyId, code),
    account.partnerId
      ? db.select({ id: customer.id }).from(customer).where(and(eq(customer.companyId, companyId), eq(customer.partnerId, account.partnerId))).limit(1)
      : Promise.resolve([]),
  ]);

  const byMonth = new Map(monthly.map((row) => [row.month, { debitCents: toCents(row.debit), creditCents: toCents(row.credit) }]));
  const openingPrevious = toCents(openings[0]?.previous ?? "0");
  const openingCurrent = toCents(openings[0]?.current ?? "0");
  const totals = totalsMap.get(code) ?? { openingCents: 0, debitCents: 0, creditCents: 0, entries: 0 };
  const node = buildChartNode(account, totalsMap, new Map());
  const isCustomerAccount = code.startsWith("43");
  const partnerHref = account.partnerId
    ? isCustomerAccount && customerRow[0]
      ? `/customers/${customerRow[0].id}`
      : !isCustomerAccount
        ? `/suppliers/${account.partnerId}`
        : null
    : null;

  return {
    account: {
      id: account.id,
      code,
      name: account.name,
      type: account.type,
      nature: node.nature,
      level: code.length,
      isPostable: account.isPostable,
      isBlocked: account.isBlocked,
      parentCode: account.parentCode,
    },
    path: pathRows.map((row) => ({ id: row.id, code: row.code, name: row.name })),
    partner: account.partnerId ? { id: account.partnerId, name: account.partnerName ?? "", taxId: account.partnerTaxId, href: partnerHref } : null,
    totals: { ...totals, balanceCents: totals.openingCents + totals.debitCents - totals.creditCents },
    months: currentKeys.map((entry) => ({ key: entry.key, label: MONTH_SHORT[entry.month], longLabel: `${MONTH_LONG[entry.month]} ${entry.year}` })),
    current: buildMonthlySeries(period.year ? `Ejercicio ${period.year.code}` : "Ejercicio actual", currentKeys.map((entry) => entry.key), byMonth, openingCurrent),
    previous: buildMonthlySeries(previousYear ? `Ejercicio ${previousYear.code}` : "Año anterior", previousKeys.map((entry) => entry.key), byMonth, openingPrevious),
    lastLines: lastLines.map((line) => ({
      lineId: line.lineId,
      entryId: line.entryId,
      number: line.number,
      postedAt: line.postedAt.toISOString(),
      accountId: line.accountId,
      accountCode: line.accountCode,
      concept: line.concept,
      reference: line.reference,
      documentType: line.documentType,
      documentNumber: line.documentNumber,
      partnerName: line.partnerName,
      debitCents: toCents(line.debit),
      creditCents: toCents(line.credit),
    })),
    childCount: children[0]?.count ?? 0,
    nextSubaccountCode: next?.code ?? null,
    range: period.keys,
  };
}

/** Árbol del plan hasta un nivel en orden de código (orden jerárquico), para exportar. */
export async function listChartForExport(companyId: string, options: ChartRange & { level: ChartLevel; filters?: ChartFilters }) {
  const tree = await getChartTree(companyId, { from: options.from, toExclusive: options.toExclusive, depth: levelToDepth(options.level), filters: options.filters });
  const depth = levelToDepth(options.level);
  // Del nivel N solo se exportan las cuentas de hasta N dígitos (las subcuentas, con «Sub»).
  const nodes = depth === null ? tree.nodes : tree.nodes.filter((node) => node.code.length <= depth);
  return { ...tree, nodes: [...nodes].sort((a, b) => a.code.localeCompare(b.code)) };
}

export type { ChartNode };
