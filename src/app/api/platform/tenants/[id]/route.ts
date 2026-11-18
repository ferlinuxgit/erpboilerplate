import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { applyPlatformTenantAction, listPlatformCreditMovements, listPlatformTenantMembers, requirePlatformAdmin } from "@/server/platform/service";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string().trim().min(3, "Indica el motivo.").max(300) }),
  z.object({ action: z.literal("unsuspend") }),
  z.object({ action: z.literal("exempt"), exempt: z.boolean() }),
  z.object({ action: z.literal("extendTrial"), days: z.number().int().min(1).max(365) }),
  z.object({ action: z.literal("grantCredits"), credits: z.number().int().min(-100_000).max(100_000).refine((value) => value !== 0), note: z.string().trim().max(200).default("") }),
]);

/** Detalle de un espacio para el panel de plataforma: miembros y movimientos de créditos. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const [members, credits] = await Promise.all([listPlatformTenantMembers(id), listPlatformCreditMovements(id)]);
    return NextResponse.json({ members, credits });
  } catch (error) {
    return handleRouteError(error, "platform.tenant.get");
  }
}

/** Suspender, reactivar, cortesía, ampliar la prueba o ajustar créditos de un espacio. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await params;
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Acción no válida.");
    await applyPlatformTenantAction(admin.id, id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "platform.tenant.patch");
  }
}
