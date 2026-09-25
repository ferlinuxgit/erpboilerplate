import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import {
  company,
  invitation,
  membership,
  tenant,
  tenantSecurityPolicy,
  user,
} from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { assignableRoles, canManageMemberWithRole, type AppRole } from "@/lib/rbac";
import { recordAudit } from "@/server/audit";

export const INVITATION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7;

export async function listTeamMembers(tenantId: string) {
  return db
    .select({
      membershipId: membership.id,
      role: membership.role,
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.tenantId, tenantId));
}

export async function updateTeamMemberRole(input: {
  tenantId: string;
  membershipId: string;
  actorUserId: string;
  actorRole: AppRole;
  role: AppRole;
}) {
  const [target] = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.id, input.membershipId),
        eq(membership.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  if (!target) return null;
  if (!canManageMemberWithRole(input.actorRole, target.role) || !assignableRoles(input.actorRole).includes(input.role))
    throw new HttpError(
      403,
      "Solo un propietario puede gestionar administradores y propietarios.",
    );
  if (target.role === "OWNER" && input.role !== "OWNER") {
    const [owners] = await db
      .select({ count: sql<number>`count(*)` })
      .from(membership)
      .where(
        and(
          eq(membership.tenantId, input.tenantId),
          eq(membership.role, "OWNER"),
          ne(membership.id, target.id),
        ),
      );
    if (Number(owners?.count ?? 0) === 0)
      throw new HttpError(409, "El espacio debe conservar al menos un propietario.");
  }
  const [updated] = await db
    .update(membership)
    .set({ role: input.role, updatedAt: new Date() })
    .where(
      and(
        eq(membership.id, input.membershipId),
        eq(membership.tenantId, input.tenantId),
      ),
    )
    .returning();
  await recordAudit({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "team.member.role.update",
    entityName: "membership",
    entityId: input.membershipId,
    payload: { from: target.role, to: input.role },
  });
  return updated;
}

export async function removeTeamMember(input: {
  tenantId: string;
  membershipId: string;
  actorUserId: string;
  actorRole: AppRole;
}) {
  const [target] = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.id, input.membershipId),
        eq(membership.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  if (!target) return false;
  if (!canManageMemberWithRole(input.actorRole, target.role))
    throw new HttpError(
      403,
      "Solo un propietario puede eliminar administradores o propietarios.",
    );
  if (target.role === "OWNER") {
    const [owners] = await db
      .select({ count: sql<number>`count(*)` })
      .from(membership)
      .where(
        and(
          eq(membership.tenantId, input.tenantId),
          eq(membership.role, "OWNER"),
          ne(membership.id, target.id),
        ),
      );
    if (Number(owners?.count ?? 0) === 0)
      throw new HttpError(409, "No puedes eliminar al único propietario del espacio.");
  }
  await db
    .delete(membership)
    .where(
      and(
        eq(membership.id, input.membershipId),
        eq(membership.tenantId, input.tenantId),
      ),
    );
  await recordAudit({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "team.member.remove",
    entityName: "membership",
    entityId: input.membershipId,
    payload: { removedUserId: target.userId, role: target.role },
  });
  return true;
}

export async function createInvitation(
  tenantId: string,
  actorUserId: string,
  payload: { email: string; role: AppRole },
) {
  const normalizedEmail = payload.email.trim().toLowerCase();
  const [policy] = await db
    .select({ allowedDomains: tenantSecurityPolicy.allowedDomains })
    .from(tenantSecurityPolicy)
    .where(eq(tenantSecurityPolicy.tenantId, tenantId))
    .limit(1);
  const allowedDomains =
    policy?.allowedDomains
      ?.split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean) ?? [];
  if (
    allowedDomains.length > 0 &&
    !allowedDomains.includes(normalizedEmail.split("@")[1] ?? "")
  )
    throw new HttpError(
      422,
      "El dominio del email no está permitido por la política de seguridad.",
    );
  const [existingMember] = await db
    .select({ id: membership.id })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.tenantId, tenantId), sql`lower(${user.email}) = ${normalizedEmail}`))
    .limit(1);
  if (existingMember) throw new HttpError(409, "Esa persona ya forma parte del equipo.");
  const created = await db.transaction(async (tx) => {
    // Una sola invitación pendiente por email: la nueva sustituye a la anterior (rol y enlace nuevos).
    await tx
      .delete(invitation)
      .where(and(eq(invitation.tenantId, tenantId), eq(invitation.email, normalizedEmail), isNull(invitation.acceptedAt)));
    const [row] = await tx
      .insert(invitation)
      .values({
        tenantId,
        email: normalizedEmail,
        role: payload.role,
        token: crypto.randomUUID(),
        invitedByUserId: actorUserId,
        expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
      })
      .returning();
    await recordAudit(
      {
        tenantId,
        actorUserId,
        action: "invitation.create",
        entityName: "invitation",
        entityId: row.id,
        payload: { email: normalizedEmail, role: payload.role },
      },
      tx,
    );
    return row;
  });
  return created;
}

/** Invitaciones sin aceptar (incluidas las caducadas, para poder reenviarlas). */
export async function listPendingInvitations(tenantId: string) {
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      invitedByName: user.name,
    })
    .from(invitation)
    .leftJoin(user, eq(user.id, invitation.invitedByUserId))
    .where(and(eq(invitation.tenantId, tenantId), isNull(invitation.acceptedAt)))
    .orderBy(asc(invitation.createdAt));
}

/** Renueva la caducidad (7 días desde hoy) de una invitación pendiente; conserva el enlace. */
export async function renewInvitation(tenantId: string, actorUserId: string, invitationId: string) {
  return db.transaction(async (tx) => {
    const [renewed] = await tx
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS) })
      .where(and(eq(invitation.id, invitationId), eq(invitation.tenantId, tenantId), isNull(invitation.acceptedAt)))
      .returning();
    if (!renewed) return null;
    await recordAudit({ tenantId, actorUserId, action: "invitation.resend", entityName: "invitation", entityId: renewed.id, payload: { email: renewed.email } }, tx);
    return renewed;
  });
}

export async function cancelInvitation(tenantId: string, actorUserId: string, invitationId: string) {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(invitation)
      .where(and(eq(invitation.id, invitationId), eq(invitation.tenantId, tenantId), isNull(invitation.acceptedAt)))
      .returning({ id: invitation.id, email: invitation.email });
    if (!removed) return false;
    await recordAudit({ tenantId, actorUserId, action: "invitation.cancel", entityName: "invitation", entityId: removed.id, payload: { email: removed.email } }, tx);
    return true;
  });
}

/**
 * Datos públicos de una invitación para la página de aceptación: espacio, empresa,
 * quién invita y rol. `null` si el enlace no existe.
 */
export async function getInvitationPreview(token: string) {
  const [row] = await db
    .select({
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      workspaceName: tenant.name,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(tenant, eq(tenant.id, invitation.tenantId))
    .leftJoin(user, eq(user.id, invitation.invitedByUserId))
    .where(eq(invitation.token, token))
    .limit(1);
  if (!row) return null;
  const [firstCompany] = await db
    .select({ name: company.name })
    .from(company)
    .innerJoin(tenant, eq(tenant.id, company.tenantId))
    .innerJoin(invitation, and(eq(invitation.tenantId, tenant.id), eq(invitation.token, token)))
    .orderBy(asc(company.createdAt))
    .limit(1);
  return { ...row, companyName: firstCompany?.name ?? row.workspaceName, expired: row.expiresAt.getTime() <= Date.now() };
}

/** Nombre del espacio de trabajo (visible en invitaciones y en el selector de espacios). */
export async function renameTenant(tenantId: string, actorUserId: string, name: string) {
  const trimmed = name.trim();
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(tenant).set({ name: trimmed, updatedAt: new Date() }).where(eq(tenant.id, tenantId)).returning({ id: tenant.id, name: tenant.name });
    if (!updated) return null;
    await recordAudit({ tenantId, actorUserId, action: "tenant.rename", entityName: "tenant", entityId: tenantId, payload: { name: trimmed } }, tx);
    return updated;
  });
}

/**
 * Acepta una invitación vigente para el email del usuario. Devuelve el tenant al
 * que se une (también si ya era miembro) o `null` si la invitación no es válida.
 */
export async function acceptInvitation(userId: string, token: string): Promise<{ tenantId: string; membershipId: string | null } | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(invitation)
      .where(eq(invitation.token, token))
      .for("update")
      .limit(1);
    if (!current || current.acceptedAt || current.expiresAt < new Date())
      return null;
    const [acceptingUser] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (
      !acceptingUser ||
      acceptingUser.email.toLowerCase() !== current.email.toLowerCase()
    )
      return null;
    const [created] = await tx
      .insert(membership)
      .values({ userId, tenantId: current.tenantId, role: current.role })
      .onConflictDoNothing()
      .returning({ id: membership.id });
    await tx
      .update(invitation)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitation.id, current.id), eq(invitation.token, token)));
    await recordAudit(
      {
        tenantId: current.tenantId,
        actorUserId: userId,
        action: "invitation.accept",
        entityName: "invitation",
        entityId: current.id,
        payload: { role: current.role, alreadyMember: !created },
      },
      tx,
    );
    return { tenantId: current.tenantId, membershipId: created?.id ?? null };
  });
}
