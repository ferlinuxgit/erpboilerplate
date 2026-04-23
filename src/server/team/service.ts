import { and, eq } from "drizzle-orm";

import { invitation, membership, user } from "@/db/schema";
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
  const [created] = await db
    .insert(invitation)
    .values({
      tenantId,
      email: payload.email,
      role: payload.role,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    })
    .returning();
  await recordAudit({ tenantId, actorUserId, action: "invitation.create", entityName: "invitation", entityId: created.id, payload });
  return created;
}

export async function acceptInvitation(userId: string, token: string) {
  const invitationRow = await db.select().from(invitation).where(eq(invitation.token, token)).limit(1);
  const current = invitationRow[0];
  if (!current || current.acceptedAt || current.expiresAt < new Date()) return null;

  const [created] = await db
    .insert(membership)
    .values({ userId, tenantId: current.tenantId, role: current.role })
    .onConflictDoNothing()
    .returning();

  await db.update(invitation).set({ acceptedAt: new Date() }).where(and(eq(invitation.id, current.id), eq(invitation.token, token)));

  return created ?? null;
}
