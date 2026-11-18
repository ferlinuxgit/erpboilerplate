import { z } from "zod";

import { isPaidModule } from "@/lib/billing/catalog";
import { HttpError } from "@/lib/http";
import { getModule, missingDependencies, type ModuleId } from "@/modules/registry";

const modulesSchema = z.object({ modules: z.array(z.string()).max(20) });

/** Módulos pedidos al contratar o cambiar el plan: válidos, sin repetir y con sus dependencias. */
export function parseRequestedModules(payload: unknown): ModuleId[] {
  const parsed = modulesSchema.safeParse(payload);
  if (!parsed.success) throw new HttpError(400, "Indica los módulos que quieres contratar.");
  const modules = [...new Set(parsed.data.modules)];
  const unknown = modules.filter((value) => !isPaidModule(value));
  if (unknown.length) throw new HttpError(400, "Algún módulo no existe.");
  const valid = modules as ModuleId[];
  for (const moduleId of valid) {
    const missing = missingDependencies(moduleId, valid);
    if (missing.length) throw new HttpError(400, `«${getModule(moduleId).name}» necesita también ${missing.map((entry) => `«${entry.name}»`).join(", ")}.`);
  }
  return valid;
}

export function billingReturnUrl() {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/billing`;
}
