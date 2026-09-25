import { eq } from "drizzle-orm";

import { company } from "@/db/schema";
import { checkCreditorId } from "@/lib/bank-import/sepa-creditor";
import { db } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";
import { recordAudit } from "@/server/audit";

export async function getSepaCreditorId(companyId: string) {
  const [row] = await db.select({ sepaCreditorId: company.sepaCreditorId, vatNumber: company.vatNumber }).from(company).where(eq(company.id, companyId)).limit(1);
  return { creditorId: row?.sepaCreditorId ?? null, vatNumber: row?.vatNumber ?? null };
}

/** Guarda (o borra, con null) el identificador de acreedor SEPA de la empresa, validado. */
export async function updateSepaCreditorId(actor: { companyId: string; tenantId: string; actorUserId: string }, value: string | null) {
  let creditorId: string | null = null;
  if (value && value.trim()) {
    const check = checkCreditorId(value);
    if (!check.valid) throw new AccountingRuleError(422, "CREDITOR_ID_INVALID", check.reason);
    creditorId = check.creditorId;
  }
  return db.transaction(async (tx) => {
    await tx.update(company).set({ sepaCreditorId: creditorId, updatedAt: new Date() }).where(eq(company.id, actor.companyId));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "company.sepa_creditor.update",
      entityName: "company",
      entityId: actor.companyId,
      payload: { sepaCreditorId: creditorId },
    }, tx);
    return { creditorId };
  });
}
