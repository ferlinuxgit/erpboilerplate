import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { account, invitation, membership, session, subscription, tenant, user } from "@/db/schema";
import { TENANT_DELETION_GRACE_DAYS } from "@/lib/billing/catalog";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit";
import { deletePrivateFile } from "@/server/storage/files";
import { stripe } from "@/server/billing/stripe";
import { buildTenantExportPlan } from "@/server/tenant/export";
import { getVerifactuTransportConfig } from "@/server/verifactu/config";

/**
 * Bajas: de un espacio (con periodo de gracia y purga final) y de un usuario (anonimizado, para
 * que el histórico —quién emitió cada factura— siga siendo coherente).
 */

async function setStripeCancelAtPeriodEnd(tenantId: string, cancel: boolean) {
  const [row] = await db.select({ stripeSubscriptionId: subscription.stripeSubscriptionId, status: subscription.status }).from(subscription).where(eq(subscription.tenantId, tenantId)).limit(1);
  if (!stripe || !row?.stripeSubscriptionId || !["ACTIVE", "TRIALING", "PAST_DUE"].includes(row.status)) return;
  await stripe.subscriptions.update(row.stripeSubscriptionId, { cancel_at_period_end: cancel });
}

/** El propietario pide la baja: solo lectura durante la gracia y la suscripción no se renueva. */
export async function requestTenantDeletion(input: { tenantId: string; actorUserId: string }) {
  await setStripeCancelAtPeriodEnd(input.tenantId, true);
  await db.update(tenant).set({ deletionRequestedAt: new Date(), updatedAt: new Date() }).where(eq(tenant.id, input.tenantId));
  await recordAudit({ tenantId: input.tenantId, actorUserId: input.actorUserId, action: "tenant.deletion.request", entityName: "tenant", entityId: input.tenantId, payload: { graceDays: TENANT_DELETION_GRACE_DAYS } });
}

export async function cancelTenantDeletion(input: { tenantId: string; actorUserId: string }) {
  await setStripeCancelAtPeriodEnd(input.tenantId, false);
  await db.update(tenant).set({ deletionRequestedAt: null, updatedAt: new Date() }).where(eq(tenant.id, input.tenantId));
  await recordAudit({ tenantId: input.tenantId, actorUserId: input.actorUserId, action: "tenant.deletion.cancel", entityName: "tenant", entityId: input.tenantId, payload: {} });
}

/**
 * Purga definitiva de un espacio dado de baja (panel de plataforma), pasada la gracia: borra sus
 * documentos guardados y todos sus datos (los registros VERI*FACTU se desbloquean solo para esta
 * transacción). Irreversible.
 */
export async function purgeTenant(input: { tenantId: string; actorUserId: string; now?: Date }) {
  const [row] = await db.select({ deletionRequestedAt: tenant.deletionRequestedAt, name: tenant.name }).from(tenant).where(eq(tenant.id, input.tenantId)).limit(1);
  if (!row) throw new HttpError(404, "Ese espacio no existe.");
  const now = input.now ?? new Date();
  if (!row.deletionRequestedAt || row.deletionRequestedAt.getTime() + TENANT_DELETION_GRACE_DAYS * 86_400_000 > now.getTime()) {
    throw new HttpError(409, `Solo se puede purgar un espacio con la baja solicitada hace más de ${TENANT_DELETION_GRACE_DAYS} días.`);
  }
  // Registros VERI*FACTU sin remitir: purgarlos sería destruir registros de facturación que la AEAT
  // aún no tiene. Con el envío activo, primero se remiten; sin él no hay forma de enviarlos y se avisa.
  const unsent = await db.execute(sql`select count(*)::int as total from "verifactu_record" where "mode" = 'VERIFACTU' and "status" = 'PENDING_SEND' and "companyId" in (select "id" from "company" where "tenantId" = ${input.tenantId})`);
  const unsentTotal = Number((unsent as unknown as { rows: Array<{ total: number }> }).rows[0]?.total ?? 0);
  if (unsentTotal > 0) {
    if (getVerifactuTransportConfig().kind === "aeat") {
      throw new HttpError(409, `Este espacio tiene ${unsentTotal} registro(s) VERI*FACTU pendientes de enviar a la AEAT: deben remitirse antes de purgarlo.`);
    }
    logger.warn({ tenantId: input.tenantId, unsentTotal }, "tenant.purge.unsent_verifactu_records");
  }
  // Documentos guardados: fuera del almacén antes de borrar las filas que los apuntan.
  const plan = buildTenantExportPlan();
  for (const entry of plan) {
    if (entry.scope.kind !== "company") continue;
    const columns = await db.execute(sql`select column_name from information_schema.columns where table_name = ${entry.table} and column_name in ('storageKey', 'pdfStorageKey')`);
    for (const { column_name: column } of (columns as unknown as { rows: Array<{ column_name: string }> }).rows) {
      const stored = await db.execute(sql`select ${sql.raw(`"${column}"`)} as "storageKey" from ${sql.raw(`"${entry.table}"`)} where ${sql.raw(`"${column}"`)} is not null and "companyId" in (select "id" from "company" where "tenantId" = ${input.tenantId})`);
      for (const document of (stored as unknown as { rows: Array<{ storageKey: string }> }).rows) {
        await deletePrivateFile(document.storageKey).catch((error) => logger.warn({ err: error, storageKey: document.storageKey }, "tenant.purge.file_failed"));
      }
    }
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('verifactu.allow_purge', 'on', true)`);
    await tx.delete(tenant).where(eq(tenant.id, input.tenantId));
  });
  logger.info({ tenantId: input.tenantId, actorUserId: input.actorUserId }, "tenant.purged");
  return { name: row.name };
}

/** Espacios donde el usuario es el único propietario (le impiden borrar su cuenta). */
export async function tenantsOnlyOwnedBy(userId: string) {
  const owned = await db.select({ tenantId: membership.tenantId, name: tenant.name }).from(membership).innerJoin(tenant, eq(tenant.id, membership.tenantId)).where(and(eq(membership.userId, userId), eq(membership.role, "OWNER")));
  if (!owned.length) return [];
  const others = await db
    .select({ tenantId: membership.tenantId })
    .from(membership)
    .where(and(inArray(membership.tenantId, owned.map((entry) => entry.tenantId)), eq(membership.role, "OWNER"), ne(membership.userId, userId)));
  const shared = new Set(others.map((entry) => entry.tenantId));
  return owned.filter((entry) => !shared.has(entry.tenantId));
}

/**
 * Borra la cuenta del usuario (art. 17 RGPD): sale de todos sus espacios, pierde sus credenciales y
 * sesiones y sus datos personales se anonimizan. No se puede siendo el único propietario de un
 * espacio activo: antes hay que pasar la propiedad o dar de baja el espacio.
 */
export async function deleteUserAccount(userId: string) {
  const blocking = await tenantsOnlyOwnedBy(userId);
  const [activeOwned] = blocking.length
    ? await db.select({ id: tenant.id, name: tenant.name }).from(tenant).where(and(inArray(tenant.id, blocking.map((entry) => entry.tenantId)), sql`${tenant.deletionRequestedAt} is null`)).limit(1)
    : [];
  if (activeOwned) {
    throw new HttpError(409, `Eres el único propietario de «${activeOwned.name}»: pasa la propiedad a otra persona o da de baja el espacio antes de borrar tu cuenta.`);
  }
  const memberships = await db.select({ tenantId: membership.tenantId }).from(membership).where(eq(membership.userId, userId));
  await db.transaction(async (tx) => {
    await tx.delete(membership).where(and(eq(membership.userId, userId), isNotNull(membership.tenantId)));
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(account).where(eq(account.userId, userId));
    await tx.update(invitation).set({ invitedByUserId: null }).where(eq(invitation.invitedByUserId, userId));
    await tx
      .update(user)
      .set({ name: "Usuario eliminado", email: `eliminado-${userId}@cuentas.invalid`, image: null, emailVerified: false, platformAdmin: false, disabledAt: new Date(), totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [], updatedAt: new Date() })
      .where(eq(user.id, userId));
    for (const { tenantId } of memberships) {
      await recordAudit({ tenantId, actorUserId: userId, action: "user.account.delete", entityName: "user", entityId: userId, payload: {} }, tx);
    }
  });
}
