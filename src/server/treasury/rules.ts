import { and, asc, eq, inArray } from "drizzle-orm";

import { accountChart, bankReconciliationRule, partner } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";
import { recordAudit } from "@/server/audit";

/** Reglas de conciliación: "concepto contiene X [e importe entre A y B] → cuenta / contrapartida". */

export type RulePayload = {
  name?: string | null;
  conceptContains: string;
  direction?: "ANY" | "IN" | "OUT";
  minAmount?: number | null;
  maxAmount?: number | null;
  accountId?: string | null;
  partnerId?: string | null;
  autoApply?: boolean;
  isActive?: boolean;
};

type Actor = { companyId: string; tenantId: string; actorUserId: string };

export async function listReconciliationRules(companyId: string) {
  return db
    .select({
      id: bankReconciliationRule.id,
      name: bankReconciliationRule.name,
      conceptContains: bankReconciliationRule.conceptContains,
      direction: bankReconciliationRule.direction,
      minAmount: bankReconciliationRule.minAmount,
      maxAmount: bankReconciliationRule.maxAmount,
      accountId: bankReconciliationRule.accountId,
      accountCode: accountChart.code,
      accountName: accountChart.name,
      partnerId: bankReconciliationRule.partnerId,
      partnerName: partner.name,
      autoApply: bankReconciliationRule.autoApply,
      isActive: bankReconciliationRule.isActive,
      timesApplied: bankReconciliationRule.timesApplied,
      lastAppliedAt: bankReconciliationRule.lastAppliedAt,
    })
    .from(bankReconciliationRule)
    .leftJoin(accountChart, eq(accountChart.id, bankReconciliationRule.accountId))
    .leftJoin(partner, eq(partner.id, bankReconciliationRule.partnerId))
    .where(eq(bankReconciliationRule.companyId, companyId))
    .orderBy(asc(bankReconciliationRule.name), asc(bankReconciliationRule.id));
}

/** Contrapartidas elegibles en una regla (clientes y proveedores activos). */
export async function listRulePartners(companyId: string) {
  return db
    .select({ id: partner.id, name: partner.name, type: partner.type })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.isActive, true), inArray(partner.type, ["CUSTOMER", "SUPPLIER", "BOTH"])))
    .orderBy(asc(partner.name))
    .limit(1000);
}

async function normalizePayload(client: DbClient, companyId: string, payload: RulePayload) {
  const conceptContains = payload.conceptContains.trim().replace(/\s+/g, " ");
  if (conceptContains.length < 3) throw new AccountingRuleError(422, "RULE_CONCEPT", "Indica al menos 3 letras del concepto (p. ej. «COMISION»).");
  const minAmount = payload.minAmount ?? null;
  const maxAmount = payload.maxAmount ?? null;
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) throw new AccountingRuleError(422, "RULE_RANGE", "El importe mínimo no puede ser mayor que el máximo.");
  if ((minAmount !== null && minAmount < 0) || (maxAmount !== null && maxAmount < 0)) throw new AccountingRuleError(422, "RULE_RANGE", "Los importes de la regla van sin signo (el sentido se elige aparte).");
  if (!payload.accountId && !payload.partnerId) throw new AccountingRuleError(422, "RULE_TARGET", "Elige la cuenta o el cliente/proveedor al que se asigna.");
  if (payload.accountId) {
    const [account] = await client
      .select({ id: accountChart.id })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, payload.accountId), eq(accountChart.isPostable, true)))
      .limit(1);
    if (!account) throw new AccountingRuleError(422, "ACCOUNT_INVALID", "La cuenta elegida no existe o no admite apuntes.");
  }
  if (payload.partnerId) {
    const [owned] = await client
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.companyId, companyId), eq(partner.id, payload.partnerId)))
      .limit(1);
    if (!owned) throw new AccountingRuleError(422, "PARTNER_INVALID", "El cliente o proveedor elegido no existe.");
  }
  return {
    name: (payload.name?.trim() || conceptContains).slice(0, 120),
    conceptContains: conceptContains.slice(0, 120),
    direction: payload.direction ?? "ANY",
    minAmount: minAmount === null ? null : minAmount.toFixed(2),
    maxAmount: maxAmount === null ? null : maxAmount.toFixed(2),
    accountId: payload.accountId || null,
    partnerId: payload.partnerId || null,
    // Aplicar sin preguntar solo tiene sentido con una cuenta (un cliente/proveedor necesita elegir factura).
    autoApply: Boolean(payload.autoApply && payload.accountId),
    isActive: payload.isActive ?? true,
  };
}

export async function createReconciliationRule(actor: Actor, payload: RulePayload, client: DbClient = db) {
  const values = await normalizePayload(client, actor.companyId, payload);
  const [created] = await client
    .insert(bankReconciliationRule)
    .values({ companyId: actor.companyId, ...values })
    .returning({ id: bankReconciliationRule.id, name: bankReconciliationRule.name });
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "treasury.rule.create", entityName: "bankReconciliationRule", entityId: created.id, payload: values }, client);
  return created;
}

export async function updateReconciliationRule(actor: Actor, id: string, payload: RulePayload) {
  return db.transaction(async (tx) => {
    const values = await normalizePayload(tx, actor.companyId, payload);
    const [updated] = await tx
      .update(bankReconciliationRule)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(bankReconciliationRule.companyId, actor.companyId), eq(bankReconciliationRule.id, id)))
      .returning({ id: bankReconciliationRule.id });
    if (!updated) return null;
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "treasury.rule.update", entityName: "bankReconciliationRule", entityId: id, payload: values }, tx);
    return updated;
  });
}

export async function deleteReconciliationRule(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(bankReconciliationRule)
      .where(and(eq(bankReconciliationRule.companyId, actor.companyId), eq(bankReconciliationRule.id, id)))
      .returning({ id: bankReconciliationRule.id, name: bankReconciliationRule.name });
    if (!deleted) return false;
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "treasury.rule.delete", entityName: "bankReconciliationRule", entityId: id, payload: { name: deleted.name } }, tx);
    return true;
  });
}
