import { eq } from "drizzle-orm";

import { expenseOcrSetting } from "@/db/schema";
import { db } from "@/lib/db";
import { recordAudit } from "@/server/audit";

export type ExpenseOcrSettings = {
  /** La empresa permite enviar documentos a un proveedor externo de IA. */
  externalAiEnabled: boolean;
  /** El servidor tiene configurado el proveedor externo (OPENAI_API_KEY). */
  externalAiConfigured: boolean;
};

export async function getExpenseOcrSettings(companyId: string, externalAiConfigured: boolean): Promise<ExpenseOcrSettings> {
  const [row] = await db
    .select({ externalAiEnabled: expenseOcrSetting.externalAiEnabled })
    .from(expenseOcrSetting)
    .where(eq(expenseOcrSetting.companyId, companyId))
    .limit(1);
  return { externalAiEnabled: row?.externalAiEnabled ?? true, externalAiConfigured };
}

export async function updateExpenseOcrSettings(
  companyId: string,
  tenantId: string,
  actorUserId: string,
  payload: { externalAiEnabled: boolean },
) {
  return db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(expenseOcrSetting)
      .values({ companyId, externalAiEnabled: payload.externalAiEnabled, updatedByUserId: actorUserId })
      .onConflictDoUpdate({
        target: expenseOcrSetting.companyId,
        set: { externalAiEnabled: payload.externalAiEnabled, updatedByUserId: actorUserId, updatedAt: new Date() },
      })
      .returning({ externalAiEnabled: expenseOcrSetting.externalAiEnabled });
    await recordAudit(
      {
        tenantId,
        companyId,
        actorUserId,
        action: "expense.ocr.settings.update",
        entityName: "expenseOcrSetting",
        entityId: companyId,
        payload,
      },
      tx,
    );
    return saved;
  });
}
