import { and, eq, sql } from "drizzle-orm";

import { posArea, posRegister, posTable } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { isModuleEnabled, setCompanyModule } from "@/server/modules/service";
import { createArea, createTables } from "@/server/pos/hospitality";
import { createRegister, type PosActor } from "@/server/pos/service";

export type SetupInput = {
  /** Caja que pasa a modo Mesas; sin ella se crea una nueva con este nombre. */
  registerId?: string | null;
  registerName?: string | null;
  areas: Array<{ name: string; tables: number; seats: number }>;
};

/**
 * Asistente de puesta en marcha de la sala, de una vez: activa el TPV y Hostelería si hace falta,
 * deja la caja en modo «Mesas» (o crea una) y crea las salas con sus mesas numeradas seguidas
 * (Salón 1–10, Terraza 11–16…) para que no se repitan nombres.
 */
export async function setupHospitality(actor: PosActor, input: SetupInput) {
  const areas = input.areas.map((area) => ({ name: area.name.trim(), tables: Math.trunc(area.tables), seats: Math.trunc(area.seats) })).filter((area) => area.name && area.tables > 0);
  if (areas.length === 0) throw new HttpError(400, "Indica al menos una sala con mesas.");
  if (areas.reduce((sum, area) => sum + area.tables, 0) > 200) throw new HttpError(400, "Como mucho 200 mesas de una vez.");
  if (new Set(areas.map((area) => area.name.toLocaleLowerCase("es-ES"))).size !== areas.length) throw new HttpError(400, "Hay dos salas con el mismo nombre.");

  for (const moduleId of ["pos", "hospitality"] as const) {
    if (!(await isModuleEnabled(actor.companyId, moduleId))) await setCompanyModule({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, moduleId, enabled: true });
  }

  let registerId = input.registerId ?? null;
  if (registerId) {
    const [updated] = await db.update(posRegister).set({ mode: "TABLES", isActive: true, updatedAt: new Date() }).where(and(eq(posRegister.id, registerId), eq(posRegister.companyId, actor.companyId))).returning({ id: posRegister.id });
    if (!updated) throw new HttpError(404, "Caja no encontrada.");
  } else {
    const created = await createRegister(actor, { name: input.registerName?.trim() || "Sala", seriesCode: "S", seriesPrefix: "S", simplifiedLimit: 400, mode: "TABLES" });
    registerId = created.id;
  }

  // Numeración seguida a partir de las mesas que ya hubiera.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(posTable).where(eq(posTable.companyId, actor.companyId));
  let next = count + 1;
  const existing = await db.select({ id: posArea.id, name: posArea.name }).from(posArea).where(eq(posArea.companyId, actor.companyId));
  let tables = 0;
  for (const area of areas) {
    const found = existing.find((entry) => entry.name.toLocaleLowerCase("es-ES") === area.name.toLocaleLowerCase("es-ES"));
    const areaId = found?.id ?? (await createArea(actor, area.name)).id;
    const result = await createTables(actor, { areaId, prefix: "Mesa", from: next, to: next + area.tables - 1, seats: Math.max(1, Math.min(50, area.seats || 4)) });
    tables += result.created;
    next += area.tables;
  }
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "pos_hospitality.setup", entityName: "pos_register", entityId: registerId, payload: { areas } });
  return { registerId, tables };
}
