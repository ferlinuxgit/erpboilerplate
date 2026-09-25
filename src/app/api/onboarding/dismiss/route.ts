import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { dismissOnboarding } from "@/server/onboarding/service";

import { requireOnboardingActor } from "@/server/onboarding/actor";

/** "Hacerlo más tarde": deja de redirigir al asistente tras iniciar sesión. */
export async function POST() {
  try {
    const { actor } = await requireOnboardingActor();
    await dismissOnboarding(actor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "onboarding.dismiss", "No se pudo posponer la configuración.");
  }
}
