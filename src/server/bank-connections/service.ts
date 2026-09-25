import { and, asc, desc, eq, gte, inArray, isNull, lte, lt, ne, or, sql } from "drizzle-orm";

import { bankAccount, bankConnection, bankConnectionAccount, bankTransaction, company, fiscalYear, membership } from "@/db/schema";
import { getBankConnectionsConfig, type BankConnectionsConfig } from "@/lib/bank-connections-config";
import { normalizeIban } from "@/lib/bank-import/iban";
import { db } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";
import { recordAudit } from "@/server/audit";
import { decryptSecret, encryptSecret } from "@/server/bank-connections/crypto";
import { GoCardlessClient, GoCardlessError, type Institution } from "@/server/bank-connections/gocardless";
import {
  CONSENT_RENEWAL_WARNING_DAYS,
  DEFAULT_ACCESS_DAYS,
  connectionStatusFromRequisition,
  consentDaysLeft,
  mapBookedTransactions,
  syncDateFrom,
} from "@/server/bank-connections/mapping";
import { importMovements } from "@/server/treasury/import";
import { autoApplyRules } from "@/server/treasury/workbench";

/*
 * Conexión bancaria PSD2 (GoCardless Bank Account Data):
 * 1. El usuario elige su banco → se crea un acuerdo (90 días de acceso, solo lectura de saldos,
 *    datos y movimientos) y una "requisition"; el usuario da su consentimiento en la web del banco.
 * 2. El banco redirige a /treasury/bank-connections/callback → se leen las cuentas autorizadas y
 *    se enlazan con nuestras cuentas bancarias por IBAN (o a mano).
 * 3. "Sincronizar ahora" o el worker (cada BANK_SYNC_INTERVAL_HOURS) traen los movimientos
 *    contabilizados y los pasan por la importación de extractos (Banco ↔ 555, deduplicación por
 *    el identificador del banco y reglas automáticas).
 * 4. A los 90 días el consentimiento caduca (PSD2): se avisa antes y se renueva con otro permiso.
 */

type Actor = { companyId: string; tenantId: string; actorUserId: string };

function requireConfig(): BankConnectionsConfig {
  const config = getBankConnectionsConfig();
  if (!config) throw new AccountingRuleError(409, "BANK_CONNECTIONS_DISABLED", "La conexión bancaria automática no está activada en este servidor.");
  return config;
}

function clientFor(config: BankConnectionsConfig) {
  return new GoCardlessClient(config);
}

function friendlyProviderError(error: unknown) {
  if (error instanceof GoCardlessError) {
    if (error.rateLimited) return "El banco limita cuántas veces al día se pueden leer los movimientos. Se reintentará más tarde.";
    if (error.consentExpired) return "El permiso del banco ha caducado o se ha retirado: renueva la conexión.";
    if (error.status >= 500) return "El servicio de conexión bancaria no responde ahora mismo. Inténtalo más tarde.";
    return `El servicio de conexión bancaria rechazó la operación (${error.status}).`;
  }
  return "No se pudo conectar con el servicio de conexión bancaria.";
}

let institutionsCache: { at: number; country: string; rows: Institution[] } | null = null;

/** Bancos disponibles (España por defecto), en caché 12 h. */
export async function listBankInstitutions(country = "ES", now = Date.now()) {
  const config = requireConfig();
  if (institutionsCache && institutionsCache.country === country && now - institutionsCache.at < 12 * 3_600_000) return institutionsCache.rows;
  try {
    const rows = await clientFor(config).listInstitutions(country);
    const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "es"));
    institutionsCache = { at: now, country, rows: sorted };
    return sorted;
  } catch (error) {
    throw new AccountingRuleError(409, "PROVIDER_ERROR", friendlyProviderError(error));
  }
}

export function resetBankInstitutionsCache() {
  institutionsCache = null;
}

/** Conexiones de la empresa con sus cuentas (sin identificadores del proveedor). */
export async function listBankConnections(companyId: string, now = new Date()) {
  const [connections, accounts] = await Promise.all([
    db
      .select({
        id: bankConnection.id,
        institutionId: bankConnection.institutionId,
        institutionName: bankConnection.institutionName,
        institutionLogo: bankConnection.institutionLogo,
        status: bankConnection.status,
        accessValidForDays: bankConnection.accessValidForDays,
        consentGrantedAt: bankConnection.consentGrantedAt,
        consentExpiresAt: bankConnection.consentExpiresAt,
        lastSyncedAt: bankConnection.lastSyncedAt,
        lastSyncError: bankConnection.lastSyncError,
        createdAt: bankConnection.createdAt,
      })
      .from(bankConnection)
      .where(and(eq(bankConnection.companyId, companyId), ne(bankConnection.status, "REVOKED")))
      .orderBy(desc(bankConnection.createdAt)),
    db
      .select({
        id: bankConnectionAccount.id,
        connectionId: bankConnectionAccount.connectionId,
        iban: bankConnectionAccount.iban,
        name: bankConnectionAccount.name,
        currency: bankConnectionAccount.currency,
        bankAccountId: bankConnectionAccount.bankAccountId,
        lastSyncedAt: bankConnectionAccount.lastSyncedAt,
        lastSyncError: bankConnectionAccount.lastSyncError,
      })
      .from(bankConnectionAccount)
      .where(eq(bankConnectionAccount.companyId, companyId))
      .orderBy(asc(bankConnectionAccount.createdAt)),
  ]);
  return connections.map((connection) => {
    const daysLeft = consentDaysLeft(connection.consentExpiresAt, now);
    return {
      ...connection,
      daysLeft,
      needsRenewal: connection.status === "EXPIRED" || (daysLeft !== null && daysLeft <= CONSENT_RENEWAL_WARNING_DAYS),
      accounts: accounts.filter((account) => account.connectionId === connection.id),
    };
  });
}

function numberOr(value: string | number | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Inicia (o renueva, con `connectionId`) una conexión: crea el acuerdo y la requisition y
 * devuelve el enlace del banco al que hay que llevar al usuario.
 */
export async function startBankConnection(actor: Actor, input: { institutionId: string; connectionId?: string | null }, now = new Date()) {
  const config = requireConfig();
  const client = clientFor(config);
  let existing: { id: string; institutionId: string } | null = null;
  if (input.connectionId) {
    const [row] = await db
      .select({ id: bankConnection.id, institutionId: bankConnection.institutionId })
      .from(bankConnection)
      .where(and(eq(bankConnection.companyId, actor.companyId), eq(bankConnection.id, input.connectionId)))
      .limit(1);
    if (!row) throw new AccountingRuleError(404, "CONNECTION_NOT_FOUND", "Conexión no encontrada.");
    existing = row;
  }
  const institutionId = existing?.institutionId ?? input.institutionId;
  try {
    const institution = await client.getInstitution(institutionId);
    const historyDays = Math.min(numberOr(institution.transaction_total_days, 90), 730);
    const accessDays = Math.min(numberOr(institution.max_access_valid_for_days, DEFAULT_ACCESS_DAYS), DEFAULT_ACCESS_DAYS);
    const agreement = await client.createAgreement({ institutionId, maxHistoricalDays: historyDays, accessValidForDays: accessDays });
    const connectionId = existing?.id ?? (await db
      .insert(bankConnection)
      .values({
        companyId: actor.companyId,
        institutionId,
        institutionName: institution.name,
        institutionLogo: institution.logo ?? null,
        status: "PENDING",
        accessValidForDays: accessDays,
        historyDays,
        createdByUserId: actor.actorUserId,
      })
      .returning({ id: bankConnection.id }))[0].id;
    const requisition = await client.createRequisition({
      institutionId,
      agreementId: agreement.id,
      redirect: `${config.appUrl}/treasury/bank-connections/callback`,
      reference: `${connectionId}.${now.getTime()}`,
    });
    // En una renovación la conexión sigue funcionando con el permiso anterior hasta volver del banco.
    await db
      .update(bankConnection)
      .set({
        requisitionIdEncrypted: encryptSecret(requisition.id, config.encryptionSecret),
        agreementIdEncrypted: encryptSecret(agreement.id, config.encryptionSecret),
        accessValidForDays: accessDays,
        historyDays,
        updatedAt: now,
      })
      .where(and(eq(bankConnection.companyId, actor.companyId), eq(bankConnection.id, connectionId)));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: existing ? "treasury.bank_connection.renew" : "treasury.bank_connection.start",
      entityName: "bankConnection",
      entityId: connectionId,
      payload: { institutionId, institutionName: institution.name, accessDays, historyDays },
    });
    if (!requisition.link) throw new AccountingRuleError(409, "PROVIDER_ERROR", "El servicio de conexión no devolvió el enlace del banco.");
    return { connectionId, link: requisition.link };
  } catch (error) {
    if (error instanceof AccountingRuleError) throw error;
    throw new AccountingRuleError(409, "PROVIDER_ERROR", friendlyProviderError(error));
  }
}

/** Vuelta del banco (`?ref=`): lee las cuentas autorizadas y las enlaza por IBAN con las nuestras. */
export async function completeBankConnection(actor: Actor, reference: string, now = new Date()) {
  const config = requireConfig();
  const connectionId = reference.split(".")[0] ?? "";
  const [connection] = await db
    .select({ id: bankConnection.id, requisitionIdEncrypted: bankConnection.requisitionIdEncrypted, accessValidForDays: bankConnection.accessValidForDays, status: bankConnection.status })
    .from(bankConnection)
    .where(and(eq(bankConnection.companyId, actor.companyId), eq(bankConnection.id, connectionId)))
    .limit(1);
  if (!connection?.requisitionIdEncrypted) throw new AccountingRuleError(404, "CONNECTION_NOT_FOUND", "No encontramos la conexión que estabas autorizando.");
  const client = clientFor(config);
  let requisition;
  try {
    requisition = await client.getRequisition(decryptSecret(connection.requisitionIdEncrypted, config.encryptionSecret));
  } catch (error) {
    throw new AccountingRuleError(409, "PROVIDER_ERROR", friendlyProviderError(error));
  }
  const status = connectionStatusFromRequisition(requisition.status);
  if (status !== "LINKED") {
    // Una renovación abandonada no estropea la conexión que ya funcionaba.
    if (connection.status !== "LINKED") {
      await db.update(bankConnection).set({ status, lastSyncError: "No se completó el permiso en el banco.", updatedAt: now }).where(eq(bankConnection.id, connection.id));
    }
    return { connectionId: connection.id, status, accounts: 0 };
  }

  const details: Array<{ externalId: string; iban: string | null; currency: string | null; name: string | null }> = [];
  for (const externalId of requisition.accounts) {
    try {
      const response = await client.getAccountDetails(externalId);
      details.push({ externalId, iban: response.account?.iban ? normalizeIban(response.account.iban) : null, currency: response.account?.currency ?? null, name: response.account?.name ?? response.account?.product ?? response.account?.ownerName ?? null });
    } catch {
      details.push({ externalId, iban: null, currency: null, name: null });
    }
  }
  const [existingAccounts, ownAccounts] = await Promise.all([
    db.select({ id: bankConnectionAccount.id, iban: bankConnectionAccount.iban }).from(bankConnectionAccount).where(and(eq(bankConnectionAccount.companyId, actor.companyId), eq(bankConnectionAccount.connectionId, connection.id))),
    db.select({ id: bankAccount.id, iban: bankAccount.iban }).from(bankAccount).where(and(eq(bankAccount.companyId, actor.companyId), eq(bankAccount.isActive, true))),
  ]);
  const linkedElsewhere = new Set((await db
    .select({ bankAccountId: bankConnectionAccount.bankAccountId })
    .from(bankConnectionAccount)
    .where(and(eq(bankConnectionAccount.companyId, actor.companyId), ne(bankConnectionAccount.connectionId, connection.id))))
    .map((row) => row.bankAccountId)
    .filter((id): id is string => Boolean(id)));
  const ownByIban = new Map(ownAccounts.map((account) => [normalizeIban(account.iban), account.id]));

  await db.transaction(async (tx) => {
    const kept = new Set<string>();
    for (const detail of details) {
      const encrypted = encryptSecret(detail.externalId, config.encryptionSecret);
      const previous = detail.iban ? existingAccounts.find((account) => account.iban === detail.iban && !kept.has(account.id)) : undefined;
      if (previous) {
        kept.add(previous.id);
        await tx.update(bankConnectionAccount).set({ externalAccountIdEncrypted: encrypted, name: detail.name, currency: detail.currency, lastSyncError: null }).where(eq(bankConnectionAccount.id, previous.id));
        continue;
      }
      const match = detail.iban ? ownByIban.get(detail.iban) : undefined;
      await tx.insert(bankConnectionAccount).values({
        companyId: actor.companyId,
        connectionId: connection.id,
        externalAccountIdEncrypted: encrypted,
        iban: detail.iban,
        name: detail.name,
        currency: detail.currency,
        bankAccountId: match && !linkedElsewhere.has(match) ? match : null,
      });
    }
    const stale = existingAccounts.filter((account) => !kept.has(account.id)).map((account) => account.id);
    if (stale.length) await tx.delete(bankConnectionAccount).where(inArray(bankConnectionAccount.id, stale));
    await tx
      .update(bankConnection)
      .set({
        status: "LINKED",
        consentGrantedAt: now,
        consentExpiresAt: new Date(now.getTime() + connection.accessValidForDays * 86_400_000),
        lastSyncError: null,
        updatedAt: now,
      })
      .where(eq(bankConnection.id, connection.id));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.bank_connection.link",
      entityName: "bankConnection",
      entityId: connection.id,
      payload: { accounts: details.length, matchedByIban: details.filter((detail) => detail.iban && ownByIban.has(detail.iban)).length },
    }, tx);
  });
  return { connectionId: connection.id, status, accounts: details.length };
}

/** Enlaza (o desenlaza, con null) una cuenta del banco con una cuenta bancaria del ERP. */
export async function linkConnectionAccount(actor: Actor, connectionId: string, accountId: string, bankAccountId: string | null) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: bankConnectionAccount.id })
      .from(bankConnectionAccount)
      .where(and(eq(bankConnectionAccount.companyId, actor.companyId), eq(bankConnectionAccount.connectionId, connectionId), eq(bankConnectionAccount.id, accountId)))
      .limit(1);
    if (!row) throw new AccountingRuleError(404, "ACCOUNT_NOT_FOUND", "Cuenta de la conexión no encontrada.");
    if (bankAccountId) {
      const [own] = await tx.select({ id: bankAccount.id }).from(bankAccount).where(and(eq(bankAccount.companyId, actor.companyId), eq(bankAccount.id, bankAccountId), eq(bankAccount.isActive, true))).limit(1);
      if (!own) throw new AccountingRuleError(404, "BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada o archivada.");
      const [taken] = await tx
        .select({ id: bankConnectionAccount.id })
        .from(bankConnectionAccount)
        .where(and(eq(bankConnectionAccount.companyId, actor.companyId), eq(bankConnectionAccount.bankAccountId, bankAccountId), ne(bankConnectionAccount.id, accountId)))
        .limit(1);
      if (taken) throw new AccountingRuleError(409, "BANK_ACCOUNT_TAKEN", "Esa cuenta ya recibe los movimientos de otra conexión.");
    }
    await tx.update(bankConnectionAccount).set({ bankAccountId }).where(eq(bankConnectionAccount.id, accountId));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "treasury.bank_connection.map_account",
      entityName: "bankConnectionAccount",
      entityId: accountId,
      payload: { connectionId, bankAccountId },
    }, tx);
    return { id: accountId, bankAccountId };
  });
}

async function activeFiscalYearId(companyId: string, now: Date) {
  const [row] = await db
    .select({ id: fiscalYear.id })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.companyId, companyId), lte(fiscalYear.startsAt, now), gte(fiscalYear.endsAt, now)))
    .limit(1);
  return row?.id ?? "";
}

export type SyncResult = { imported: number; duplicates: number; skipped: number; autoAssigned: number; errors: string[] };

/** Sincroniza los movimientos contabilizados de las cuentas enlazadas de una conexión. */
export async function syncBankConnection(actor: Actor, connectionId: string, now = new Date()): Promise<SyncResult> {
  const config = requireConfig();
  const [connection] = await db
    .select({ id: bankConnection.id, status: bankConnection.status, consentExpiresAt: bankConnection.consentExpiresAt, historyDays: bankConnection.historyDays })
    .from(bankConnection)
    .where(and(eq(bankConnection.companyId, actor.companyId), eq(bankConnection.id, connectionId)))
    .limit(1);
  if (!connection) throw new AccountingRuleError(404, "CONNECTION_NOT_FOUND", "Conexión no encontrada.");
  if (connection.status === "LINKED" && connection.consentExpiresAt && connection.consentExpiresAt.getTime() < now.getTime()) {
    await db.update(bankConnection).set({ status: "EXPIRED", updatedAt: now }).where(eq(bankConnection.id, connection.id));
    throw new AccountingRuleError(409, "CONSENT_EXPIRED", "El permiso de 90 días ha caducado: renueva la conexión para seguir recibiendo movimientos.");
  }
  if (connection.status !== "LINKED") throw new AccountingRuleError(409, "CONNECTION_NOT_LINKED", "La conexión no está activa: complétala o renuévala primero.");

  const accounts = await db
    .select({
      id: bankConnectionAccount.id,
      externalAccountIdEncrypted: bankConnectionAccount.externalAccountIdEncrypted,
      bankAccountId: bankConnectionAccount.bankAccountId,
      lastBookingDate: bankConnectionAccount.lastBookingDate,
      isActive: bankAccount.isActive,
    })
    .from(bankConnectionAccount)
    .innerJoin(bankAccount, eq(bankAccount.id, bankConnectionAccount.bankAccountId))
    .where(and(eq(bankConnectionAccount.companyId, actor.companyId), eq(bankConnectionAccount.connectionId, connection.id)));

  const client = clientFor(config);
  const result: SyncResult = { imported: 0, duplicates: 0, skipped: 0, autoAssigned: 0, errors: [] };
  const importedIds: string[] = [];
  let expired = false;
  for (const account of accounts) {
    if (!account.bankAccountId || !account.isActive) continue;
    try {
      const [other] = await db
        .select({ latest: sql<Date | null>`max(${bankTransaction.postedAt})`.mapWith((value: string | Date | null) => (value ? new Date(value) : null)) })
        .from(bankTransaction)
        .where(and(eq(bankTransaction.bankAccountId, account.bankAccountId), or(isNull(bankTransaction.importSource), ne(bankTransaction.importSource, "PSD2"))));
      const dateFrom = syncDateFrom({ now, historyDays: connection.historyDays, lastBookingDate: account.lastBookingDate, lastOtherSourceDate: other?.latest ?? null });
      const response = await client.getAccountTransactions(decryptSecret(account.externalAccountIdEncrypted, config.encryptionSecret), dateFrom);
      const mapped = mapBookedTransactions(response.transactions?.booked ?? []);
      const imported = await importMovements(actor, account.bankAccountId, mapped.movements, "PSD2");
      importedIds.push(...imported.importedIds);
      result.imported += imported.importedIds.length;
      result.duplicates += imported.duplicates.length;
      result.skipped += mapped.skipped + imported.locked.length;
      const latest = mapped.movements.reduce<Date | null>((max, movement) => (!max || movement.postedAt > max ? movement.postedAt : max), account.lastBookingDate);
      await db.update(bankConnectionAccount).set({ lastSyncedAt: now, lastBookingDate: latest, lastSyncError: null }).where(eq(bankConnectionAccount.id, account.id));
    } catch (error) {
      if (error instanceof GoCardlessError && error.consentExpired) expired = true;
      const message = error instanceof AccountingRuleError ? error.message : friendlyProviderError(error);
      result.errors.push(message);
      await db.update(bankConnectionAccount).set({ lastSyncError: message }).where(eq(bankConnectionAccount.id, account.id));
    }
  }
  if (importedIds.length) {
    const auto = await autoApplyRules({ ...actor, activeFiscalYearId: await activeFiscalYearId(actor.companyId, now) }, importedIds);
    result.autoAssigned = auto.applied;
  }
  await db
    .update(bankConnection)
    .set({ lastSyncedAt: now, lastSyncError: result.errors[0] ?? null, status: expired ? "EXPIRED" : "LINKED", updatedAt: now })
    .where(eq(bankConnection.id, connection.id));
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "treasury.bank_connection.sync",
    entityName: "bankConnection",
    entityId: connection.id,
    payload: { ...result, errors: result.errors.length },
  });
  return result;
}

/** Retira el permiso (borra la requisition en el proveedor) y deja de sincronizar. */
export async function revokeBankConnection(actor: Actor, connectionId: string, now = new Date()) {
  const config = getBankConnectionsConfig();
  const [connection] = await db
    .select({ id: bankConnection.id, requisitionIdEncrypted: bankConnection.requisitionIdEncrypted })
    .from(bankConnection)
    .where(and(eq(bankConnection.companyId, actor.companyId), eq(bankConnection.id, connectionId)))
    .limit(1);
  if (!connection) return null;
  if (config && connection.requisitionIdEncrypted) {
    try {
      await clientFor(config).deleteRequisition(decryptSecret(connection.requisitionIdEncrypted, config.encryptionSecret));
    } catch (error) {
      // Si ya no existe en el proveedor da igual: lo importante es dejar de usarla aquí.
      if (!(error instanceof GoCardlessError) || (error.status !== 404 && !error.consentExpired)) {
        throw new AccountingRuleError(409, "PROVIDER_ERROR", friendlyProviderError(error));
      }
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(bankConnectionAccount).where(eq(bankConnectionAccount.connectionId, connection.id));
    await tx
      .update(bankConnection)
      .set({ status: "REVOKED", requisitionIdEncrypted: null, agreementIdEncrypted: null, updatedAt: now })
      .where(eq(bankConnection.id, connection.id));
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "treasury.bank_connection.revoke", entityName: "bankConnection", entityId: connection.id, payload: {} }, tx);
  });
  return { id: connection.id };
}

/**
 * Tarea programada (worker de recurrencias): sincroniza las conexiones activas cuya última
 * sincronización tenga más de BANK_SYNC_INTERVAL_HOURS y marca como caducadas las vencidas.
 * Cada conexión es independiente: un fallo no detiene las demás.
 */
export async function syncDueBankConnections(now = new Date()) {
  const config = getBankConnectionsConfig();
  if (!config) return { enabled: false, synced: 0, failed: 0, expired: 0, imported: 0 };
  const expiredRows = await db
    .update(bankConnection)
    .set({ status: "EXPIRED", updatedAt: now })
    .where(and(eq(bankConnection.status, "LINKED"), lt(bankConnection.consentExpiresAt, now)))
    .returning({ id: bankConnection.id });
  const threshold = new Date(now.getTime() - config.syncIntervalHours * 3_600_000);
  const due = await db
    .select({ id: bankConnection.id, companyId: bankConnection.companyId, tenantId: company.tenantId, createdByUserId: bankConnection.createdByUserId })
    .from(bankConnection)
    .innerJoin(company, eq(company.id, bankConnection.companyId))
    .where(and(eq(bankConnection.status, "LINKED"), or(isNull(bankConnection.lastSyncedAt), lt(bankConnection.lastSyncedAt, threshold))))
    .orderBy(asc(bankConnection.lastSyncedAt))
    .limit(200);
  let synced = 0;
  let failed = 0;
  let imported = 0;
  for (const row of due) {
    let actorUserId = row.createdByUserId;
    if (!actorUserId) {
      const [owner] = await db.select({ userId: membership.userId }).from(membership).where(and(eq(membership.tenantId, row.tenantId), eq(membership.role, "OWNER"))).limit(1);
      actorUserId = owner?.userId ?? null;
    }
    if (!actorUserId) {
      failed += 1;
      continue;
    }
    try {
      const result = await syncBankConnection({ companyId: row.companyId, tenantId: row.tenantId, actorUserId }, row.id, now);
      imported += result.imported;
      if (result.errors.length) failed += 1;
      else synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { enabled: true, synced, failed, expired: expiredRows.length, imported };
}
