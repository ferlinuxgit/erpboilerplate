import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { companyModule, companySettings } from "@/db/schema";
import { parseBusinessType } from "@/lib/company-readiness";
import { db } from "@/lib/db";
import { ForbiddenError, HttpError } from "@/lib/http";
import { activeDependents, getModule, missingDependencies, MODULES, resolveEnabledModules, type ModuleId } from "@/modules/registry";
import { recordAudit } from "@/server/audit";

/** 403 de una ruta de un módulo que la empresa no tiene activado. */
export class ModuleDisabledError extends ForbiddenError {
  constructor(readonly moduleId: ModuleId) {
    super(`El módulo «${getModule(moduleId).name}» no está activado en esta empresa. Actívalo en Configuración → Módulos.`);
    this.name = "ModuleDisabledError";
  }
}

async function loadCompanyModules(companyId: string) {
  const [settings, [company]] = await Promise.all([
    db.select({ moduleId: companyModule.moduleId, enabled: companyModule.enabled }).from(companyModule).where(eq(companyModule.companyId, companyId)),
    db.select({ businessType: companySettings.businessType }).from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1),
  ]);
  const businessType = parseBusinessType(company?.businessType);
  return { enabled: resolveEnabledModules(settings, businessType), settings, businessType };
}

/** Módulos activos de la empresa (memoizado por petición). */
export const getCompanyModules = cache(loadCompanyModules);

export async function getEnabledModules(companyId: string): Promise<ModuleId[]> {
  return (await getCompanyModules(companyId)).enabled;
}

export async function isModuleEnabled(companyId: string, moduleId: ModuleId) {
  return (await getEnabledModules(companyId)).includes(moduleId);
}

export async function assertModuleEnabled(companyId: string, moduleId: ModuleId) {
  if (!(await isModuleEnabled(companyId, moduleId))) throw new ModuleDisabledError(moduleId);
}

export type ModuleState = {
  id: ModuleId;
  enabled: boolean;
  /** La empresa lo ha decidido (si no, es el valor por defecto según lo que vende). */
  explicit: boolean;
};

export async function listModuleStates(companyId: string): Promise<ModuleState[]> {
  const { enabled, settings } = await loadCompanyModules(companyId);
  return MODULES.map((manifest) => ({
    id: manifest.id,
    enabled: enabled.includes(manifest.id),
    explicit: settings.some((setting) => setting.moduleId === manifest.id),
  }));
}

/**
 * Activa o desactiva un módulo. No se activa sin sus dependencias ni se desactiva mientras otro
 * módulo activo lo necesite. Desactivar no borra datos.
 */
export async function setCompanyModule(input: { tenantId: string; companyId: string; actorUserId: string; moduleId: ModuleId; enabled: boolean }) {
  const { enabled } = await loadCompanyModules(input.companyId);
  const manifest = getModule(input.moduleId);
  if (input.enabled) {
    const missing = missingDependencies(input.moduleId, enabled);
    if (missing.length > 0) throw new HttpError(409, `Para activar «${manifest.name}» activa antes: ${missing.map((entry) => `«${entry.name}»`).join(", ")}.`);
  } else {
    const dependents = activeDependents(input.moduleId, enabled);
    if (dependents.length > 0) throw new HttpError(409, `«${manifest.name}» lo usa ${dependents.map((entry) => `«${entry.name}»`).join(", ")}: desactívalo antes.`);
  }
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: companyModule.id })
      .from(companyModule)
      .where(and(eq(companyModule.companyId, input.companyId), eq(companyModule.moduleId, input.moduleId)))
      .limit(1);
    if (existing) {
      await tx.update(companyModule).set({ enabled: input.enabled, updatedByUserId: input.actorUserId, updatedAt: new Date() }).where(eq(companyModule.id, existing.id));
    } else {
      await tx.insert(companyModule).values({ companyId: input.companyId, moduleId: input.moduleId, enabled: input.enabled, updatedByUserId: input.actorUserId });
    }
    await recordAudit({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: input.enabled ? "manifest.enable" : "manifest.disable",
      entityName: "company_module",
      entityId: input.moduleId,
      payload: { moduleId: input.moduleId, name: manifest.name },
    }, tx);
  });
  return listModuleStates(input.companyId);
}
