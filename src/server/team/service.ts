import { and, eq } from "drizzle-orm";

import { invitation, membership, tenantSecurityPolicy, user } from "@/db/schema";
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

export async function createInvitation(tenantId: string, actorUserId: string, payload: { email: string; role: "OWNER" | "ADMIN" | "MEMBER" }) {
  const normalizedEmail = payload.email.trim().toLowerCase();
  const [policy] = await db.select({ allowedDomains: tenantSecurityPolicy.allowedDomains }).from(tenantSecurityPolicy).where(eq(tenantSecurityPolicy.tenantId, tenantId)).limit(1);
  const allowedDomains = policy?.allowedDomains?.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
  if (allowedDomains.length > 0 && !allowedDomains.includes(normalizedEmail.split("@")[1] ?? "")) throw new Error("El dominio del email no está permitido por la política de seguridad.");
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
  await recordAudit({ tenantId, actorUserId, action: "invitation.create", entityName: "invitation", entityId: created.id, payload });
  return created;
}

export async function acceptInvitation(userId: string, token: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(invitation).where(eq(invitation.token, token)).for("update").limit(1);
    if (!current || current.acceptedAt || current.expiresAt < new Date()) return null;
    const [acceptingUser] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
    if (!acceptingUser || acceptingUser.email.toLowerCase() !== current.email.toLowerCase()) return null;
    const [created] = await tx.insert(membership).values({ userId, tenantId: current.tenantId, role: current.role }).onConflictDoNothing().returning();
    await tx.update(invitation).set({ acceptedAt: new Date() }).where(and(eq(invitation.id, current.id), eq(invitation.token, token)));
    return created ?? null;
  });
}
