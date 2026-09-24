import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getFiscalYearLifecycle, listFiscalYears, openNextFiscalYear } from "@/server/accounting/fiscal-years";

const payloadSchema = z.object({ fromFiscalYearId: z.string().trim().min(1).optional() }).nullable();

/** Ejercicios de la empresa y estado del ejercicio activo (para el aviso de apertura). */
export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.read")) return NextResponse.json({ message: "Sin permisos de contabilidad." }, { status: 403 });
  const [years, lifecycle] = await Promise.all([
    listFiscalYears(ctx.company.id),
    getFiscalYearLifecycle(ctx.company.id, ctx.fiscalYear.id),
  ]);
  return NextResponse.json({ companyId: ctx.company.id, years, lifecycle });
}

/**
 * Abre el ejercicio siguiente al indicado (o al activo). Idempotente. Tras abrirlo, la UI cambia
 * el contexto activo con PATCH /api/context/active.
 */
export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos para abrir ejercicios." }, { status: 403 });
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  try {
    const result = await openNextFiscalYear({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: session.user.id,
      fromFiscalYearId: parsed.data?.fromFiscalYearId ?? ctx.fiscalYear.id,
    });
    return NextResponse.json({ ...result, companyId: ctx.company.id }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return handleRouteError(error, "accounting.fiscal-years.open", "No se pudo abrir el ejercicio siguiente. Inténtalo de nuevo.");
  }
}
