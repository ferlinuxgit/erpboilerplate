import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { MODULE_IDS } from "@/modules/registry";
import { listModuleStates, setCompanyModule } from "@/server/modules/service";

const payloadSchema = z.object({ moduleId: z.enum(MODULE_IDS), enabled: z.boolean() });

/** Módulos opcionales de la empresa activa y si están activados. */
export async function GET() {
  try {
    const ctx = await requireContext();
    return NextResponse.json({ modules: await listModuleStates(ctx.company.id) });
  } catch (error) {
    return handleRouteError(error, "modules.list");
  }
}

/** Activa o desactiva un módulo (no borra datos). */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("settings.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Módulo no válido.");
    const modules = await setCompanyModule({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: ctx.user.id,
      moduleId: parsed.data.moduleId,
      enabled: parsed.data.enabled,
    });
    return NextResponse.json({ modules });
  } catch (error) {
    return handleRouteError(error, "modules.update");
  }
}
