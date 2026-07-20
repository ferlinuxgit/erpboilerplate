import { and, eq, ne, sql } from "drizzle-orm";

import {
  invitation,
  membership,
  tenantSecurityPolicy,
  user,
} from "@/db/schema";
import { db } from "@/lib/db";
import { recordAudit } from "@/server/audit";

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
  actorRole: "OWNER" | "ADMIN" | "MEMBER";
  role: "OWNER" | "ADMIN" | "MEMBER";
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
  if (
    input.actorRole !== "OWNER" &&
    (target.role !== "MEMBER" || input.role === "OWNER")
  )
    throw new Error(
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
      throw new Error("El espacio debe conservar al menos un propietario.");
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
  actorRole: "OWNER" | "ADMIN" | "MEMBER";
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
  if (input.actorRole !== "OWNER" && target.role !== "MEMBER")
    throw new Error(
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
      throw new Error("No puedes eliminar al único propietario del espacio.");
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
  payload: { email: string; role: "OWNER" | "ADMIN" | "MEMBER" },
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
    throw new Error(
      "El dominio del email no está permitido por la política de seguridad.",
    );
  const [created] = await db
    .insert(invitation)
    .values({
      tenantId,
      email: normalizedEmail,
      role: payload.role,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    })
    .returning();
  await recordAudit({
    tenantId,
    actorUserId,
    action: "invitation.create",
    entityName: "invitation",
    entityId: created.id,
    payload,
  });
  return created;
}

export async function acceptInvitation(userId: string, token: string) {
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
      .returning();
    await tx
      .update(invitation)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitation.id, current.id), eq(invitation.token, token)));
    return created ?? null;
  });
}
