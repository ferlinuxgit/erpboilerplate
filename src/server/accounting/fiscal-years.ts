import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { accountChart, documentSeries, fiscalYear, journalEntry, journalLine } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { createAutomaticEntry, loadPostingSettings, reverseAutomaticEntries, type PostingLine } from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";
import { centsToAmount, sumCents, toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";
import { fiscalYearEndExclusive } from "@/server/fiscal/locks";

/**
 * Ciclo de vida del ejercicio (PGC 2024):
 *
 * 1. Regularización (31/12 del ejercicio N): los saldos de gastos (6) e ingresos (7) se
 *    trasladan a 129 "Resultado del ejercicio".
 * 2. Cierre (31/12 de N): se saldan todas las cuentas de balance (grupos 1-5, incluida 129).
 * 3. Apertura (1/1 de N+1): asiento inverso al de cierre en el ejercicio siguiente.
 *
 * "Abrir ejercicio N+1" crea el ejercicio y sus series para poder seguir trabajando aunque N
 * no esté cerrado. El asiento de apertura se genera en cuanto N está cerrado (al abrir N+1 si N
 * ya estaba cerrado, o al cerrar N si N+1 ya existía). Todo es idempotente: los asientos
 * automáticos del ciclo están protegidos por un índice único (sourceType, sourceId).
 */

export const FISCAL_YEAR_SOURCE = {
  regularization: "fiscalYearRegularization",
  closing: "fiscalYearClosing",
  opening: "fiscalYearOpening",
} as const;

export const FISCAL_YEAR_LIFECYCLE_SOURCES: string[] = Object.values(FISCAL_YEAR_SOURCE);

export type AccountBalance = { accountId: string; code: string; type: string; balanceCents: number };

type FiscalYearRow = { id: string; code: string; startsAt: Date; endsAt: Date; isClosed: boolean };

/** Cuentas de resultados: grupos 6 y 7 del PGC (o tipos REVENUE/EXPENSE en otros planes). */
export function isProfitAndLossAccount(account: { code: string; type: string }, countryCode: string) {
  if (countryCode === "ES") return account.code.startsWith("6") || account.code.startsWith("7");
  return account.type === "REVENUE" || account.type === "EXPENSE";
}

/** Asiento de regularización: salda 6/7 contra 129. Devuelve [] si no hay saldos. */
export function buildRegularizationLines(profitAndLoss: AccountBalance[], resultAccountId: string): PostingLine[] {
  const lines = profitAndLoss
    .filter((row) => row.balanceCents !== 0)
    .map((row) => ({
      accountId: row.accountId,
      debit: row.balanceCents < 0 ? centsToAmount(-row.balanceCents) : "0.00",
      credit: row.balanceCents > 0 ? centsToAmount(row.balanceCents) : "0.00",
    }));
  if (lines.length === 0) return [];
  const net = sumCents(profitAndLoss.map((row) => row.balanceCents));
  // net > 0: los gastos superan a los ingresos (pérdida) → 129 al debe.
  if (net !== 0) {
    lines.push({
      accountId: resultAccountId,
      debit: net > 0 ? centsToAmount(net) : "0.00",
      credit: net < 0 ? centsToAmount(-net) : "0.00",
    });
  }
  return lines;
}

/** Asiento de cierre: salda todas las cuentas de balance. El libro debe estar cuadrado. */
export function buildClosingLines(balanceSheet: AccountBalance[]): PostingLine[] {
  const open = balanceSheet.filter((row) => row.balanceCents !== 0);
  const net = sumCents(open.map((row) => row.balanceCents));
  if (net !== 0) {
    throw new AccountingRuleError(
      422,
      "LEDGER_UNBALANCED",
      `El balance no cuadra (diferencia ${centsToAmount(net)}). Revisa los asientos antes de cerrar el ejercicio.`,
    );
  }
  return open.map((row) => ({
    accountId: row.accountId,
    debit: row.balanceCents < 0 ? centsToAmount(-row.balanceCents) : "0.00",
    credit: row.balanceCents > 0 ? centsToAmount(row.balanceCents) : "0.00",
  }));
}

/** Asiento de apertura: inverso exacto del de cierre. */
export function buildOpeningLines(closingLines: Array<{ accountId: string; debit: string | number; credit: string | number }>): PostingLine[] {
  return closingLines.map((line) => ({ accountId: line.accountId, debit: line.credit, credit: line.debit }));
}

/** Rango del ejercicio siguiente (mismo número de meses, empieza el día después del fin). */
export function nextFiscalYearRange(current: { code: string; startsAt: Date; endsAt: Date }) {
  const startsAt = fiscalYearEndExclusive(current.endsAt);
  const months =
    (current.endsAt.getUTCFullYear() - current.startsAt.getUTCFullYear()) * 12 +
    (current.endsAt.getUTCMonth() - current.startsAt.getUTCMonth()) + 1;
  const endsAt = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + months, 0));
  const startYear = startsAt.getUTCFullYear();
  const endYear = endsAt.getUTCFullYear();
  const code = startYear === endYear ? String(startYear) : `${startYear}-${String(endYear).slice(-2)}`;
  return { code, startsAt, endsAt };
}

export type FiscalYearLifecycleState = {
  activeYear: { id: string; code: string; startsAt: string; endsAt: string; isClosed: boolean };
  nextYear: { id: string; code: string } | null;
  nextYearCode: string;
  daysUntilEnd: number;
  alert: "none" | "ending-soon" | "ended";
};

/** Estado para el aviso de "abrir ejercicio" (función pura). */
export function describeFiscalYearLifecycle(active: FiscalYearRow, years: FiscalYearRow[], today = new Date()): FiscalYearLifecycleState {
  const next = nextFiscalYearRange(active);
  const existingNext = years.find((year) => year.startsAt.getTime() === next.startsAt.getTime()) ?? null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const endUtc = Date.UTC(active.endsAt.getUTCFullYear(), active.endsAt.getUTCMonth(), active.endsAt.getUTCDate());
  const daysUntilEnd = Math.round((endUtc - todayUtc) / 86_400_000);
  const alert = daysUntilEnd < 0 ? "ended" : daysUntilEnd <= 30 ? "ending-soon" : "none";
  return {
    activeYear: {
      id: active.id,
      code: active.code,
      startsAt: active.startsAt.toISOString(),
      endsAt: active.endsAt.toISOString(),
      isClosed: active.isClosed,
    },
    nextYear: existingNext ? { id: existingNext.id, code: existingNext.code } : null,
    nextYearCode: existingNext?.code ?? next.code,
    daysUntilEnd,
    alert,
  };
}

export async function listFiscalYears(companyId: string, client: DbClient = db): Promise<FiscalYearRow[]> {
  return client
    .select({ id: fiscalYear.id, code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt, isClosed: fiscalYear.isClosed })
    .from(fiscalYear)
    .where(eq(fiscalYear.companyId, companyId))
    .orderBy(asc(fiscalYear.startsAt));
}

export async function getFiscalYearLifecycle(companyId: string, activeFiscalYearId: string, today = new Date()) {
  const years = await listFiscalYears(companyId);
  const active = years.find((year) => year.id === activeFiscalYearId);
  if (!active) return null;
  return describeFiscalYearLifecycle(active, years, today);
}

async function accountBalances(
  client: DbClient,
  companyId: string,
  range: { from?: Date; toExclusive: Date },
): Promise<AccountBalance[]> {
  const rows = await client
    .select({
      accountId: journalLine.accountId,
      code: accountChart.code,
      type: accountChart.type,
      balance: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), '0')`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(
      eq(journalEntry.companyId, companyId),
      range.from ? gte(journalEntry.postedAt, range.from) : undefined,
      lt(journalEntry.postedAt, range.toExclusive),
    ))
    .groupBy(journalLine.accountId, accountChart.code, accountChart.type)
    .orderBy(accountChart.code);
  return rows.map((row) => ({ accountId: row.accountId, code: row.code, type: row.type, balanceCents: toCents(row.balance) }));
}

async function findActiveLifecycleEntry(client: DbClient, companyId: string, sourceType: string, sourceId: string) {
  const [entry] = await client
    .select({ id: journalEntry.id, number: journalEntry.number })
    .from(journalEntry)
    .where(and(
      eq(journalEntry.companyId, companyId),
      eq(journalEntry.sourceType, sourceType),
      eq(journalEntry.sourceId, sourceId),
      isNull(journalEntry.reversedAt),
      isNull(journalEntry.reversesEntryId),
    ))
    .limit(1);
  return entry ?? null;
}

async function findResultAccountId(client: DbClient, companyId: string) {
  const [resultAccount] = await client
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.isPostable, true), sql`${accountChart.code} like '129%'`))
    .orderBy(accountChart.code)
    .limit(1);
  if (!resultAccount) {
    throw new AccountingRuleError(422, "ACCOUNT_MISSING", "Falta la cuenta 129 \"Resultado del ejercicio\" en el plan contable. Créala antes de cerrar.");
  }
  return resultAccount.id;
}

type Actor = { companyId: string; tenantId: string; actorUserId: string };

/** Genera el asiento de apertura de `targetYear` a partir del cierre de `sourceYear`, si procede. */
async function ensureOpeningEntry(client: DbClient, actor: Actor, sourceYear: FiscalYearRow, targetYear: FiscalYearRow) {
  const existing = await findActiveLifecycleEntry(client, actor.companyId, FISCAL_YEAR_SOURCE.opening, targetYear.id);
  if (existing) return { entryId: existing.id, number: existing.number, created: false };
  if (!sourceYear.isClosed || targetYear.isClosed) return null;
  const closing = await findActiveLifecycleEntry(client, actor.companyId, FISCAL_YEAR_SOURCE.closing, sourceYear.id);
  if (!closing) return null;
  const closingLines = await client
    .select({ accountId: journalLine.accountId, debit: journalLine.debit, credit: journalLine.credit })
    .from(journalLine)
    .where(eq(journalLine.journalEntryId, closing.id));
  if (closingLines.length === 0) return null;
  const created = await createAutomaticEntry({
    ...actor,
    dbClient: client,
    postedAt: targetYear.startsAt,
    reference: `Asiento de apertura ejercicio ${targetYear.code}`,
    action: "accounting.autopost.fiscalYearOpening",
    entityName: "fiscalYear",
    entityId: targetYear.id,
    sourceType: FISCAL_YEAR_SOURCE.opening,
    sourceId: targetYear.id,
    lines: buildOpeningLines(closingLines),
  });
  return { entryId: created.id, number: created.number, created: true };
}

async function lockFiscalYear(client: DbClient, companyId: string, fiscalYearId: string) {
  const [year] = await client
    .select({ id: fiscalYear.id, code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt, isClosed: fiscalYear.isClosed })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.id, fiscalYearId), eq(fiscalYear.companyId, companyId)))
    .for("update")
    .limit(1);
  if (!year) throw new AccountingRuleError(404, "FISCAL_YEAR_NOT_FOUND", "Ejercicio no encontrado.");
  return year;
}

/**
 * Cierra el ejercicio: regularización (6/7 → 129), cierre de cuentas de balance y, si ya existe
 * el ejercicio siguiente, su asiento de apertura. Idempotente: si ya está cerrado devuelve el estado.
 */
export async function closeFiscalYear(input: Actor & { fiscalYearId: string }) {
  return db.transaction(async (tx) => {
    const year = await lockFiscalYear(tx, input.companyId, input.fiscalYearId);
    const years = await listFiscalYears(input.companyId, tx);
    const nextRange = nextFiscalYearRange(year);
    const nextYear = years.find((candidate) => candidate.startsAt.getTime() === nextRange.startsAt.getTime()) ?? null;

    if (year.isClosed) {
      const opening = nextYear ? await ensureOpeningEntry(tx, input, year, nextYear) : null;
      return { fiscalYear: year, alreadyClosed: true, regularizationEntryId: null, closingEntryId: null, openingEntryId: opening?.entryId ?? null };
    }

    const previousOpen = years.find((candidate) => candidate.startsAt < year.startsAt && !candidate.isClosed);
    if (previousOpen) {
      throw new AccountingRuleError(409, "PREVIOUS_YEAR_OPEN", `Antes de cerrar ${year.code} tienes que cerrar el ejercicio ${previousOpen.code}.`);
    }

    const settings = await loadPostingSettings(input.companyId, tx);
    const endExclusive = fiscalYearEndExclusive(year.endsAt);
    const regularizationDate = new Date(endExclusive.getTime() - 2_000);
    const closingDate = new Date(endExclusive.getTime() - 1_000);

    // 1) Regularización.
    let regularizationEntryId: string | null = null;
    const existingRegularization = await findActiveLifecycleEntry(tx, input.companyId, FISCAL_YEAR_SOURCE.regularization, year.id);
    if (existingRegularization) {
      regularizationEntryId = existingRegularization.id;
    } else {
      const yearBalances = await accountBalances(tx, input.companyId, { from: year.startsAt, toExclusive: endExclusive });
      const profitAndLoss = yearBalances.filter((row) => isProfitAndLossAccount(row, settings.countryCode));
      const regularizationLines = buildRegularizationLines(profitAndLoss, await findResultAccountId(tx, input.companyId));
      if (regularizationLines.length > 0) {
        const created = await createAutomaticEntry({
          ...input,
          dbClient: tx,
          postedAt: regularizationDate,
          reference: `Regularización ejercicio ${year.code}`,
          action: "accounting.autopost.fiscalYearRegularization",
          entityName: "fiscalYear",
          entityId: year.id,
          sourceType: FISCAL_YEAR_SOURCE.regularization,
          sourceId: year.id,
          lines: regularizationLines,
        });
        regularizationEntryId = created.id;
      }
    }

    // 2) Cierre: saldos acumulados de balance hasta el fin del ejercicio.
    let closingEntryId: string | null = null;
    const existingClosing = await findActiveLifecycleEntry(tx, input.companyId, FISCAL_YEAR_SOURCE.closing, year.id);
    if (existingClosing) {
      closingEntryId = existingClosing.id;
    } else {
      const cumulative = await accountBalances(tx, input.companyId, { toExclusive: endExclusive });
      const pendingProfitAndLoss = cumulative.filter((row) => isProfitAndLossAccount(row, settings.countryCode) && row.balanceCents !== 0);
      const balanceSheet = cumulative.filter((row) => !isProfitAndLossAccount(row, settings.countryCode));
      if (pendingProfitAndLoss.length > 0) {
        throw new AccountingRuleError(
          422,
          "PNL_NOT_REGULARIZED",
          `Hay saldos de gastos o ingresos sin regularizar de ejercicios anteriores (cuentas ${pendingProfitAndLoss.slice(0, 5).map((row) => row.code).join(", ")}). Cierra primero esos ejercicios o regulariza los saldos con un asiento manual.`,
        );
      }
      const closingLines = buildClosingLines(balanceSheet);
      if (closingLines.length > 0) {
        const created = await createAutomaticEntry({
          ...input,
          dbClient: tx,
          postedAt: closingDate,
          reference: `Asiento de cierre ejercicio ${year.code}`,
          action: "accounting.autopost.fiscalYearClosing",
          entityName: "fiscalYear",
          entityId: year.id,
          sourceType: FISCAL_YEAR_SOURCE.closing,
          sourceId: year.id,
          lines: closingLines,
        });
        closingEntryId = created.id;
      }
    }

    const closedAt = new Date();
    const [updated] = await tx
      .update(fiscalYear)
      .set({ isClosed: true, closedAt })
      .where(and(eq(fiscalYear.id, year.id), eq(fiscalYear.companyId, input.companyId)))
      .returning({ id: fiscalYear.id, code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt, isClosed: fiscalYear.isClosed });

    // 3) Apertura del siguiente si ya existe.
    const opening = nextYear ? await ensureOpeningEntry(tx, input, updated, nextYear) : null;

    await recordAudit({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: "accounting.fiscalYear.close",
      entityName: "fiscalYear",
      entityId: year.id,
      payload: { code: year.code, regularizationEntryId, closingEntryId, openingEntryId: opening?.entryId ?? null },
    }, tx);

    return { fiscalYear: updated, alreadyClosed: false, regularizationEntryId, closingEntryId, openingEntryId: opening?.entryId ?? null };
  });
}

/**
 * Reabre un ejercicio cerrado: anula (con asientos inversos, sin borrar nada) el asiento de
 * apertura del ejercicio siguiente y los de cierre y regularización de este ejercicio, y lo
 * marca como abierto. Solo se permite si ningún ejercicio posterior está cerrado. Tras reabrir,
 * `closeFiscalYear` vuelve a generar los asientos porque ignora los ya anulados.
 * La restricción "solo el propietario" se aplica en la ruta.
 */
export async function reopenFiscalYear(input: Actor & { fiscalYearId: string; reason: string }) {
  return db.transaction(async (tx) => {
    const year = await lockFiscalYear(tx, input.companyId, input.fiscalYearId);
    if (!year.isClosed) {
      throw new AccountingRuleError(409, "FISCAL_YEAR_NOT_CLOSED", `El ejercicio ${year.code} no está cerrado.`);
    }

    const years = await listFiscalYears(input.companyId, tx);
    const laterClosed = years.filter((candidate) => candidate.startsAt > year.startsAt && candidate.isClosed);
    if (laterClosed.length > 0) {
      // Hay que reabrir en orden inverso: primero el último ejercicio cerrado.
      const latest = laterClosed[laterClosed.length - 1];
      throw new AccountingRuleError(409, "LATER_YEAR_CLOSED", `Antes de reabrir ${year.code} tienes que reabrir el ejercicio ${latest.code}.`);
    }

    const nextRange = nextFiscalYearRange(year);
    const nextYear = years.find((candidate) => candidate.startsAt.getTime() === nextRange.startsAt.getTime()) ?? null;
    const endExclusive = fiscalYearEndExclusive(year.endsAt);
    const regularizationDate = new Date(endExclusive.getTime() - 2_000);
    const closingDate = new Date(endExclusive.getTime() - 1_000);
    const reference = `Anulación por reapertura del ejercicio ${year.code}: ${input.reason}`;
    const actor = { tenantId: input.tenantId, companyId: input.companyId, actorUserId: input.actorUserId, dbClient: tx };

    // Orden inverso al del cierre: apertura del siguiente, cierre y regularización.
    const opening = nextYear
      ? await reverseAutomaticEntries({ ...actor, postedAt: nextYear.startsAt, reference, reason: reference, sourceType: FISCAL_YEAR_SOURCE.opening, sourceId: nextYear.id })
      : 0;
    const closing = await reverseAutomaticEntries({ ...actor, postedAt: closingDate, reference, reason: reference, sourceType: FISCAL_YEAR_SOURCE.closing, sourceId: year.id });
    const regularization = await reverseAutomaticEntries({ ...actor, postedAt: regularizationDate, reference, reason: reference, sourceType: FISCAL_YEAR_SOURCE.regularization, sourceId: year.id });

    const [updated] = await tx
      .update(fiscalYear)
      .set({ isClosed: false, closedAt: null })
      .where(and(eq(fiscalYear.id, year.id), eq(fiscalYear.companyId, input.companyId)))
      .returning({ id: fiscalYear.id, code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt, isClosed: fiscalYear.isClosed });

    const reversed = { opening, closing, regularization };
    await recordAudit({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: "accounting.fiscalYear.reopen",
      entityName: "fiscalYear",
      entityId: year.id,
      payload: { code: year.code, reason: input.reason, reversed, nextFiscalYearId: nextYear?.id ?? null },
    }, tx);

    return { fiscalYear: updated ?? { ...year, isClosed: false }, reversed };
  });
}

/**
 * Abre el ejercicio siguiente a `fromFiscalYearId`: lo crea (si no existe), copia las series de
 * documentos del ejercicio origen y genera el asiento de apertura si el origen ya está cerrado.
 * Idempotente: repetir la llamada devuelve el mismo ejercicio sin duplicar nada.
 */
export async function openNextFiscalYear(input: Actor & { fromFiscalYearId: string }) {
  return db.transaction(async (tx) => {
    const source = await lockFiscalYear(tx, input.companyId, input.fromFiscalYearId);
    const range = nextFiscalYearRange(source);

    const [existing] = await tx
      .select({ id: fiscalYear.id, code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt, isClosed: fiscalYear.isClosed })
      .from(fiscalYear)
      .where(and(eq(fiscalYear.companyId, input.companyId), eq(fiscalYear.startsAt, range.startsAt)))
      .limit(1);

    let target = existing ?? null;
    let created = false;
    if (!target) {
      const [codeClash] = await tx
        .select({ id: fiscalYear.id })
        .from(fiscalYear)
        .where(and(eq(fiscalYear.companyId, input.companyId), eq(fiscalYear.code, range.code)))
        .limit(1);
      if (codeClash) {
        throw new AccountingRuleError(409, "FISCAL_YEAR_CODE_TAKEN", `Ya existe un ejercicio con el código ${range.code} pero con otras fechas. Revísalo antes de continuar.`);
      }
      const [inserted] = await tx
        .insert(fiscalYear)
        .values({ companyId: input.companyId, code: range.code, startsAt: range.startsAt, endsAt: range.endsAt })
        .returning({ id: fiscalYear.id, code: fiscalYear.code, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt, isClosed: fiscalYear.isClosed });
      target = inserted;
      created = true;
    }

    // Series por ejercicio: se copian todas (código, nombre, prefijo, formato, por defecto y activa) y
    // el siguiente número para no reutilizar numeraciones (la reserva usa el máximo de cada serie).
    const sourceSeries = await tx
      .select({
        type: documentSeries.type,
        code: documentSeries.code,
        name: documentSeries.name,
        prefix: documentSeries.prefix,
        format: documentSeries.format,
        nextNumber: documentSeries.nextNumber,
        isDefault: documentSeries.isDefault,
        isActive: documentSeries.isActive,
      })
      .from(documentSeries)
      .where(and(eq(documentSeries.companyId, input.companyId), eq(documentSeries.fiscalYearId, source.id)));
    let seriesCreated = 0;
    if (sourceSeries.length > 0) {
      const inserted = await tx
        .insert(documentSeries)
        .values(sourceSeries.map((series) => ({ companyId: input.companyId, fiscalYearId: target.id, ...series })))
        .onConflictDoNothing()
        .returning({ id: documentSeries.id });
      seriesCreated = inserted.length;
    }

    const opening = await ensureOpeningEntry(tx, input, source, target);

    if (created || seriesCreated > 0 || opening?.created) {
      await recordAudit({
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "accounting.fiscalYear.open",
        entityName: "fiscalYear",
        entityId: target.id,
        payload: { code: target.code, fromFiscalYearId: source.id, created, seriesCreated, openingEntryId: opening?.entryId ?? null },
      }, tx);
    }

    return {
      fiscalYear: target,
      created,
      seriesCreated,
      openingEntryId: opening?.entryId ?? null,
      openingPending: !opening && !source.isClosed,
    };
  });
}
