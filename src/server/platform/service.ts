import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { notFound } from "next/navigation";

import { company, membership, ocrCreditLedger, session, subscription, tenant, user } from "@/db/schema";
import { computeBillingAccess } from "@/lib/billing/access";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ForbiddenError, HttpError, UnauthorizedError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { billingEnforced } from "@/server/billing/access";

/**
 * Panel interno de la plataforma: ver todos los espacios, suspenderlos, dar cortesía o créditos y
 * bloquear usuarios. Solo para administradores de la plataforma (`user.platformAdmin`); todo queda
 * en la auditoría del espacio afectado.
 */

async function loadAdmin() {
  const session = await getUserSession();
  if (!session?.user) return null;
  const [row] = await db.select({ id: user.id, name: user.name, platformAdmin: user.platformAdmin }).from(user).where(eq(user.id, session.user.id)).limit(1);
  return row?.platformAdmin ? row : null;
}

/** Para la API: 401 sin sesión, 403 si no es administrador de la plataforma. */
export async function requirePlatformAdmin() {
  const session = await getUserSession();
  if (!session?.user) throw new UnauthorizedError();
  const admin = await loadAdmin();
  if (!admin) throw new ForbiddenError("Solo para administradores de la plataforma.");
  return admin;
}

/** Para las páginas: quien no es administrador ve un 404 (el panel no se anuncia). */
export async function requirePlatformAdminPage() {
  const admin = await loadAdmin();
  if (!admin) notFound();
  return admin;
}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function listPlatformTenants(input: { q?: string; limit?: number } = {}) {
  const q = input.q?.trim();
  const owner = db.$with("owner").as(db.select({ tenantId: tenant.id, email: user.email, name: user.name }).from(tenant).innerJoin(user, eq(user.id, tenant.ownerId)));
  const rows = await db
    .with(owner)
    .select({
      id: tenant.id,
      name: tenant.name,
      createdAt: tenant.createdAt,
      trialEndsAt: tenant.trialEndsAt,
      billingExempt: tenant.billingExempt,
      suspendedAt: tenant.suspendedAt,
      suspendedReason: tenant.suspendedReason,
      deletionRequestedAt: tenant.deletionRequestedAt,
      ownerEmail: owner.email,
      ownerName: owner.name,
      status: subscription.status,
      addons: subscription.addons,
      pastDueSince: subscription.pastDueSince,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
    })
    .from(tenant)
    .innerJoin(owner, eq(owner.tenantId, tenant.id))
    .leftJoin(subscription, eq(subscription.tenantId, tenant.id))
    .where(q ? or(ilike(tenant.name, `%${q}%`), ilike(owner.email, `%${q}%`), eq(tenant.id, q)) : undefined)
    .orderBy(desc(tenant.createdAt))
    .limit(Math.min(input.limit ?? 100, 500));
  const ids = rows.map((row) => row.id);
  const [members, companies, credits] = ids.length
    ? await Promise.all([
        db.select({ tenantId: membership.tenantId, count: sql<number>`count(*)::int` }).from(membership).where(inArray(membership.tenantId, ids)).groupBy(membership.tenantId),
        db.select({ tenantId: company.tenantId, count: sql<number>`count(*)::int` }).from(company).where(inArray(company.tenantId, ids)).groupBy(company.tenantId),
        db
          .select({
            tenantId: ocrCreditLedger.tenantId,
            balance: sql<number>`coalesce(sum(${ocrCreditLedger.delta}), 0)::int`,
            monthCostMicroUsd: sql<number>`coalesce(sum(${ocrCreditLedger.costMicroUsd}) filter (where ${ocrCreditLedger.createdAt} >= ${monthStart()}), 0)::bigint`,
            monthReadings: sql<number>`count(*) filter (where ${ocrCreditLedger.kind} = 'USAGE' and ${ocrCreditLedger.createdAt} >= ${monthStart()})::int`,
          })
          .from(ocrCreditLedger)
          .where(inArray(ocrCreditLedger.tenantId, ids))
          .groupBy(ocrCreditLedger.tenantId),
      ])
    : [[], [], []];
  const enforced = billingEnforced();
  return rows.map((row) => {
    const access = computeBillingAccess({
      enforced,
      trialEndsAt: row.trialEndsAt,
      billingExempt: row.billingExempt,
      suspendedAt: row.suspendedAt,
      suspendedReason: row.suspendedReason,
      deletionRequestedAt: row.deletionRequestedAt,
      subscription: row.status ? { status: row.status, addons: row.addons ?? [], pastDueSince: row.pastDueSince, currentPeriodEndsAt: row.currentPeriodEndsAt } : null,
    });
    const credit = credits.find((entry) => entry.tenantId === row.id);
    return {
      ...row,
      state: access.state,
      members: members.find((entry) => entry.tenantId === row.id)?.count ?? 0,
      companies: companies.find((entry) => entry.tenantId === row.id)?.count ?? 0,
      creditBalance: credit?.balance ?? 0,
      monthOcrCostUsd: Number(credit?.monthCostMicroUsd ?? 0) / 1_000_000,
      monthReadings: credit?.monthReadings ?? 0,
    };
  });
}

export type PlatformTenantRow = Awaited<ReturnType<typeof listPlatformTenants>>[number];

/** Totales de la plataforma: espacios por estado y coste real de la IA este mes. */
export function summarizePlatform(rows: readonly PlatformTenantRow[]) {
  const count = (state: string) => rows.filter((row) => row.state === state).length;
  return {
    tenants: rows.length,
    paying: count("active") + count("grace"),
    trial: count("trial"),
    readOnly: rows.filter((row) => ["past_due", "trial_expired", "canceled"].includes(row.state)).length,
    suspended: count("suspended"),
    monthOcrCostUsd: rows.reduce((total, row) => total + row.monthOcrCostUsd, 0),
    monthReadings: rows.reduce((total, row) => total + row.monthReadings, 0),
  };
}

export type PlatformTenantAction =
  | { action: "suspend"; reason: string }
  | { action: "unsuspend" }
  | { action: "exempt"; exempt: boolean }
  | { action: "extendTrial"; days: number }
  | { action: "grantCredits"; credits: number; note: string };

export async function applyPlatformTenantAction(adminId: string, tenantId: string, input: PlatformTenantAction) {
  const [target] = await db.select({ id: tenant.id, trialEndsAt: tenant.trialEndsAt }).from(tenant).where(eq(tenant.id, tenantId)).limit(1);
  if (!target) throw new HttpError(404, "Ese espacio no existe.");
  await db.transaction(async (tx) => {
    switch (input.action) {
      case "suspend":
        await tx.update(tenant).set({ suspendedAt: new Date(), suspendedReason: input.reason.slice(0, 300), updatedAt: new Date() }).where(eq(tenant.id, tenantId));
        break;
      case "unsuspend":
        await tx.update(tenant).set({ suspendedAt: null, suspendedReason: null, updatedAt: new Date() }).where(eq(tenant.id, tenantId));
        break;
      case "exempt":
        await tx.update(tenant).set({ billingExempt: input.exempt, updatedAt: new Date() }).where(eq(tenant.id, tenantId));
        break;
      case "extendTrial": {
        // Desde hoy o desde el final actual, lo que sea más tarde.
        const from = target.trialEndsAt && target.trialEndsAt > new Date() ? target.trialEndsAt : new Date();
        await tx.update(tenant).set({ trialEndsAt: new Date(from.getTime() + input.days * 86_400_000), updatedAt: new Date() }).where(eq(tenant.id, tenantId));
        break;
      }
      case "grantCredits":
        await tx.insert(ocrCreditLedger).values({ tenantId, kind: "ADJUSTMENT", delta: input.credits, description: input.note.slice(0, 200) || "Ajuste de la plataforma", actorUserId: adminId });
        break;
    }
    await recordAudit({ tenantId, actorUserId: adminId, action: `platform.tenant.${input.action}`, entityName: "tenant", entityId: tenantId, payload: input }, tx);
  });
}

export async function listPlatformTenantMembers(tenantId: string) {
  return db
    .select({ userId: user.id, name: user.name, email: user.email, role: membership.role, disabledAt: user.disabledAt, platformAdmin: user.platformAdmin })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.tenantId, tenantId));
}

export type PlatformUserAction = { action: "disable" | "enable" | "revokeSessions" };

/** Bloquear (también cierra sus sesiones), desbloquear o cerrar todas las sesiones de un usuario. */
export async function applyPlatformUserAction(adminId: string, userId: string, input: PlatformUserAction) {
  if (userId === adminId && input.action === "disable") throw new HttpError(409, "No puedes bloquearte a ti mismo.");
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
  if (!target) throw new HttpError(404, "Ese usuario no existe.");
  const tenants = await db.select({ tenantId: membership.tenantId }).from(membership).where(eq(membership.userId, userId));
  await db.transaction(async (tx) => {
    if (input.action !== "revokeSessions") await tx.update(user).set({ disabledAt: input.action === "disable" ? new Date() : null, updatedAt: new Date() }).where(eq(user.id, userId));
    if (input.action !== "enable") await tx.delete(session).where(eq(session.userId, userId));
    for (const { tenantId } of tenants) {
      await recordAudit({ tenantId, actorUserId: adminId, action: `platform.user.${input.action}`, entityName: "user", entityId: userId, payload: input }, tx);
    }
  });
}

/** Movimientos de créditos recientes del espacio (con coste real de cada lectura). */
export async function listPlatformCreditMovements(tenantId: string) {
  return db
    .select({ id: ocrCreditLedger.id, kind: ocrCreditLedger.kind, delta: ocrCreditLedger.delta, description: ocrCreditLedger.description, costMicroUsd: ocrCreditLedger.costMicroUsd, inputTokens: ocrCreditLedger.inputTokens, outputTokens: ocrCreditLedger.outputTokens, createdAt: ocrCreditLedger.createdAt })
    .from(ocrCreditLedger)
    .where(and(eq(ocrCreditLedger.tenantId, tenantId), gte(ocrCreditLedger.createdAt, new Date(Date.now() - 90 * 86_400_000))))
    .orderBy(desc(ocrCreditLedger.createdAt))
    .limit(50);
}
