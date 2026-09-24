import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { updateVerifactuSettings } from "@/server/verifactu/settings";

const payloadSchema = z.object({
  mode: z.enum(["pending", "verifactu", "non_verifactu"]),
  since: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** Activa o cambia el modo VERI*FACTU (exige NIF de empresa válido). */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("fiscal.write");
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ message: "Indica el modo y, si quieres, una fecha de inicio válida (AAAA-MM-DD)." }, { status: 400 });
    }
    const since = parsed.data.since ? new Date(`${parsed.data.since}T00:00:00Z`) : null;
    const result = await updateVerifactuSettings(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id },
      { mode: parsed.data.mode, since },
    );
    return NextResponse.json({ mode: result.mode, since: result.since?.toISOString() ?? null });
  } catch (error) {
    return handleRouteError(error, "verifactu.settings", "No se pudo guardar el modo VERI*FACTU.");
  }
}
