import { and, desc, eq } from "drizzle-orm";

import { advisorAccess, advisorSession, auditLog } from "@/db/schema";
import { ADVISOR_PASSWORD_MIN_LENGTH, normalizeAdvisorScopes, type AdvisorScope } from "@/lib/advisor-scopes";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { advisorAccessStatus, generateAdvisorPassword, normalizeAdvisorEmail } from "@/server/advisor/access-model";
import { hashAdvisorPassword } from "@/server/advisor/auth";
import { recordAudit } from "@/server/audit";

/**
 * Gestión de los accesos del asesor desde Configuración (propietario o administrador).
 * La contraseña solo se devuelve en claro al crearla o regenerarla; se guarda con argon2.
 */

type Actor = { tenantId: string; companyId: string; actorUserId: string };

export type AdvisorAccessRow = Awaited<ReturnType<typeof listAdvisorAccesses>>[number];

export async function listAdvisorAccesses(companyId: string, now = new Date()) {
  const rows = await db
    .select({
      id: advisorAccess.id,
      name: advisorAccess.name,
      firm: advisorAccess.firm,
      email: advisorAccess.email,
      scopes: advisorAccess.scopes,
      expiresAt: advisorAccess.expiresAt,
      revokedAt: advisorAccess.revokedAt,
      lastLoginAt: advisorAccess.lastLoginAt,
      createdAt: advisorAccess.createdAt,
    })
    .from(advisorAccess)
    .where(eq(advisorAccess.companyId, companyId))
    .orderBy(desc(advisorAccess.createdAt));
  return rows.map((row) => ({ ...row, scopes: normalizeAdvisorScopes(row.scopes), status: advisorAccessStatus(row, now) }));
}

/** Últimos accesos y descargas de los asesores de la empresa (de la auditoría). */
export async function listAdvisorActivity(companyId: string, limit = 30) {
  const rows = await db
    .select({ id: auditLog.id, action: auditLog.action, entityId: auditLog.entityId, payload: auditLog.payload, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.entityName, "advisorAccess")))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }
    return { id: row.id, action: row.action, accessId: row.entityId, createdAt: row.createdAt, payload };
  });
}

function validatePassword(password: string) {
  if (password.length < ADVISOR_PASSWORD_MIN_LENGTH) throw new HttpError(400, `La contraseña debe tener al menos ${ADVISOR_PASSWORD_MIN_LENGTH} caracteres.`);
  if (password.length > 200) throw new HttpError(400, "La contraseña es demasiado larga.");
}

function validateScopes(scopes: AdvisorScope[]) {
  if (scopes.length === 0) throw new HttpError(400, "Elige al menos una sección para el asesor.");
}

async function loadAccess(companyId: string, id: string) {
  const [row] = await db.select({ id: advisorAccess.id, name: advisorAccess.name, email: advisorAccess.email }).from(advisorAccess).where(and(eq(advisorAccess.companyId, companyId), eq(advisorAccess.id, id))).limit(1);
  if (!row) throw new HttpError(404, "Acceso de asesor no encontrado.");
  return row;
}

export async function createAdvisorAccess(actor: Actor, input: { name: string; firm: string | null; email: string; password?: string | null; scopes: unknown; expiresAt: Date | null }) {
  const email = normalizeAdvisorEmail(input.email);
  const scopes = normalizeAdvisorScopes(input.scopes);
  validateScopes(scopes);
  const password = input.password?.trim() ? input.password : generateAdvisorPassword();
  validatePassword(password);
  const [existing] = await db.select({ id: advisorAccess.id }).from(advisorAccess).where(and(eq(advisorAccess.companyId, actor.companyId), eq(advisorAccess.email, email))).limit(1);
  if (existing) throw new HttpError(409, "Ya hay un acceso de asesor con ese email en esta empresa. Cambia su contraseña o reactívalo en lugar de crear otro.");

  const now = new Date();
  const passwordHash = await hashAdvisorPassword(password);
  const [created] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(advisorAccess)
      .values({ tenantId: actor.tenantId, companyId: actor.companyId, name: input.name, firm: input.firm, email, passwordHash, scopes, expiresAt: input.expiresAt, credentialsChangedAt: now, createdByUserId: actor.actorUserId, createdAt: now, updatedAt: now })
      .returning({ id: advisorAccess.id, name: advisorAccess.name, email: advisorAccess.email });
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "advisor.create", entityName: "advisorAccess", entityId: inserted[0].id, payload: { name: input.name, email, scopes, expiresAt: input.expiresAt } }, tx);
    return inserted;
  });
  return { ...created, password };
}

export type AdvisorAccessUpdate =
  | { action: "revoke" }
  | { action: "reactivate" }
  | { action: "reset-password"; password?: string | null }
  | { action: "update"; name: string; firm: string | null; scopes: unknown; expiresAt: Date | null };

/** Revocar, reactivar, regenerar la contraseña o cambiar datos y secciones. Devuelve la contraseña nueva si la hay. */
export async function updateAdvisorAccess(actor: Actor, id: string, change: AdvisorAccessUpdate): Promise<{ password: string | null }> {
  const access = await loadAccess(actor.companyId, id);
  const now = new Date();
  let password: string | null = null;
  let values: Partial<typeof advisorAccess.$inferInsert>;
  let auditPayload: Record<string, unknown> = { action: change.action };

  switch (change.action) {
    case "revoke":
      values = { revokedAt: now };
      break;
    case "reactivate":
      // Al reactivar, las sesiones de antes de la revocación siguen sin valer.
      values = { revokedAt: null, credentialsChangedAt: now };
      break;
    case "reset-password": {
      password = change.password?.trim() ? change.password : generateAdvisorPassword();
      validatePassword(password);
      values = { passwordHash: await hashAdvisorPassword(password), credentialsChangedAt: now };
      break;
    }
    case "update": {
      const scopes = normalizeAdvisorScopes(change.scopes);
      validateScopes(scopes);
      values = { name: change.name, firm: change.firm, scopes, expiresAt: change.expiresAt };
      auditPayload = { ...auditPayload, name: change.name, scopes, expiresAt: change.expiresAt };
      break;
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(advisorAccess).set({ ...values, updatedAt: now }).where(and(eq(advisorAccess.companyId, actor.companyId), eq(advisorAccess.id, id)));
    // Revocar o cambiar la contraseña cierra en el acto las sesiones abiertas con este acceso activo.
    if (change.action === "revoke" || change.action === "reset-password") {
      await tx.delete(advisorSession).where(eq(advisorSession.activeAccessId, id));
    }
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: `advisor.${change.action === "reset-password" ? "resetPassword" : change.action}`, entityName: "advisorAccess", entityId: id, payload: { ...auditPayload, email: access.email } }, tx);
  });
  return { password };
}

export async function deleteAdvisorAccess(actor: Actor, id: string) {
  const access = await loadAccess(actor.companyId, id);
  await db.transaction(async (tx) => {
    // Las sesiones con este acceso activo se borran en cascada.
    await tx.delete(advisorAccess).where(and(eq(advisorAccess.companyId, actor.companyId), eq(advisorAccess.id, id)));
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "advisor.delete", entityName: "advisorAccess", entityId: id, payload: { name: access.name, email: access.email } }, tx);
  });
}
