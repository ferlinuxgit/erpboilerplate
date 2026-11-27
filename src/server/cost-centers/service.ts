import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { costCenter, fixedAsset, journalLine } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";

/*
 * Centros de coste (contabilidad analítica): maestro mínimo de código y nombre al que apunta
 * `journal_line.costCenterId`. Un centro con apuntes o con bienes asignados no se borra (se perdería
 * la analítica ya contabilizada): se desactiva y deja de ofrecerse.
 */

type Actor = { tenantId: string; companyId: string; actorUserId: string };

export const costCenterInputSchema = z.object({
  code: z.string().trim().min(1, "Indica el código del centro de coste.").max(20, "El código no puede superar 20 caracteres.").regex(/^[\p{L}\p{N}._-]+$/u, "El código solo admite letras, números, punto, guion y guion bajo."),
  name: z.string().trim().min(1, "Indica el nombre del centro de coste.").max(120, "El nombre no puede superar 120 caracteres."),
  isActive: z.boolean().optional(),
});

export type CostCenterInput = z.infer<typeof costCenterInputSchema>;

/** Código tal como se guarda: sin espacios y en mayúsculas, para que «adm» y «ADM» sean el mismo. */
export function normalizeCostCenterCode(code: string) {
  return code.trim().toUpperCase();
}

export async function listCostCenters(companyId: string) {
  const usage = sql<number>`(select count(*) from ${journalLine} where ${journalLine.costCenterId} = ${costCenter.id})`;
  const assets = sql<number>`(select count(*) from ${fixedAsset} where ${fixedAsset.costCenterId} = ${costCenter.id})`;
  return db
    .select({
      id: costCenter.id,
      code: costCenter.code,
      name: costCenter.name,
      isActive: costCenter.isActive,
      lineCount: usage.mapWith(Number),
      assetCount: assets.mapWith(Number),
    })
    .from(costCenter)
    .where(eq(costCenter.companyId, companyId))
    .orderBy(asc(costCenter.code));
}

async function assertCodeFree(companyId: string, code: string, exceptId?: string) {
  const [existing] = await db
    .select({ id: costCenter.id })
    .from(costCenter)
    .where(and(eq(costCenter.companyId, companyId), eq(costCenter.code, code), exceptId ? ne(costCenter.id, exceptId) : undefined))
    .limit(1);
  if (existing) throw new HttpError(409, `Ya existe un centro de coste con el código ${code}.`);
}

export async function createCostCenter(actor: Actor, input: CostCenterInput) {
  const code = normalizeCostCenterCode(input.code);
  await assertCodeFree(actor.companyId, code);
  const [created] = await db
    .insert(costCenter)
    .values({ companyId: actor.companyId, code, name: input.name.trim(), isActive: input.isActive ?? true })
    .returning({ id: costCenter.id, code: costCenter.code, name: costCenter.name, isActive: costCenter.isActive });
  await recordAudit({ ...actor, action: "costCenter.create", entityName: "costCenter", entityId: created.id, payload: { code, name: created.name } });
  return created;
}

export async function updateCostCenter(actor: Actor, id: string, input: CostCenterInput) {
  const code = normalizeCostCenterCode(input.code);
  await assertCodeFree(actor.companyId, code, id);
  const [updated] = await db
    .update(costCenter)
    .set({ code, name: input.name.trim(), ...(input.isActive === undefined ? {} : { isActive: input.isActive }), updatedAt: new Date() })
    .where(and(eq(costCenter.companyId, actor.companyId), eq(costCenter.id, id)))
    .returning({ id: costCenter.id, code: costCenter.code, name: costCenter.name, isActive: costCenter.isActive });
  if (!updated) return null;
  await recordAudit({ ...actor, action: "costCenter.update", entityName: "costCenter", entityId: id, payload: { code, name: updated.name, isActive: updated.isActive } });
  return updated;
}

/** Borra un centro sin uso. Con apuntes o bienes asignados hay que desactivarlo. */
export async function deleteCostCenter(actor: Actor, id: string) {
  const [row] = (await listCostCenters(actor.companyId)).filter((center) => center.id === id);
  if (!row) return null;
  if (row.lineCount > 0 || row.assetCount > 0) {
    throw new HttpError(409, `El centro ${row.code} tiene ${row.lineCount > 0 ? "apuntes contables" : "bienes de inmovilizado"} asignados: desactívalo en lugar de borrarlo.`);
  }
  await db.delete(costCenter).where(and(eq(costCenter.companyId, actor.companyId), eq(costCenter.id, id)));
  await recordAudit({ ...actor, action: "costCenter.delete", entityName: "costCenter", entityId: id, payload: { code: row.code } });
  return { id };
}
