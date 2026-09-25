import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { onboardingStepPayloadSchema } from "@/lib/onboarding";
import { saveOnboardingStep } from "@/server/onboarding/service";

import { requireOnboardingActor } from "@/server/onboarding/actor";

/** Guarda un paso del asistente (o un dato suelto, como qué vende la empresa). */
export async function PATCH(request: Request) {
  try {
    const { actor } = await requireOnboardingActor();
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = onboardingStepPayloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Revisa los datos marcados.");
    const saved = await saveOnboardingStep(actor, parsed.data);
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    return handleRouteError(error, "onboarding.update", "No se pudieron guardar los datos.");
  }
}
