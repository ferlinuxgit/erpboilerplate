import { NextResponse } from "next/server";
import type { z } from "zod";

import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import type { Actor } from "@/server/payroll/service";

type RouteContext = { tenant: { id: string }; company: { id: string; countryCode?: string | null } };

/**
 * Actor de una ruta de nóminas. Las nóminas usan las cuentas del PGC y los modelos de la AEAT: solo
 * existen para las empresas cuyo país tiene modelos oficiales (`features.taxReports`).
 */
export function payrollActor(ctx: RouteContext, user: { id: string }): Actor {
  assertCountryFeature(ctx.company.countryCode, "taxReports");
  return { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id };
}

/** Lee y valida el cuerpo JSON; devuelve los datos o la respuesta de error ya montada. */
export async function parsePayrollBody<S extends z.ZodType>(request: Request, schema: S): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  const payload = await readJsonBody(request);
  if (!payload) return { response: invalidJsonResponse() };
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { response: NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 }) };
  return { data: parsed.data };
}

/** Fecha civil de hoy (AAAA-MM-DD) en hora peninsular (el contexto de las rutas no trae la zona de la empresa). */
export function todayIso(timeZone?: string | null) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
