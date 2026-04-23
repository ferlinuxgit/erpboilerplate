import { auditLog } from "@/db/schema";
import { db } from "@/lib/db";

type AuditParams = {
  tenantId: string;
  companyId?: string;
  actorUserId?: string;
  action: string;
  entityName: string;
  entityId: string;
  payload?: unknown;
};

export async function recordAudit(params: AuditParams) {
  await db.insert(auditLog).values({
    tenantId: params.tenantId,
    companyId: params.companyId,
    actorUserId: params.actorUserId,
    action: params.action,
    entityName: params.entityName,
    entityId: params.entityId,
    payload: params.payload ? JSON.stringify(params.payload) : null,
  });
}
