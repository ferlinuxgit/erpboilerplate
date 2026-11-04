import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requireAdvisorApi, switchAdvisorCompany } from "@/server/advisor/auth";

const schema = z.object({ accessId: z.string().min(1).max(64) });

/** Cambia la empresa que ve el asesor (gestorías con varias empresas y la misma contraseña). */
export async function POST(request: Request) {
  try {
    const context = await requireAdvisorApi();
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) return invalidJsonResponse("Elige una empresa.");
    await switchAdvisorCompany(context, parsed.data.accessId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "advisor.company", "No se pudo cambiar de empresa.");
  }
}
