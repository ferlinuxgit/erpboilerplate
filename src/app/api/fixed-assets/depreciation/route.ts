import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { isIsoDate } from "@/server/fixed-assets/schedule";
import { postDepreciationSchema } from "@/server/fixed-assets/schemas";
import { postDepreciation, previewDepreciation } from "@/server/fixed-assets/service";

/** Amortizaciones pendientes de contabilizar hasta `?until=AAAA-MM-DD` (no escribe nada). */
export async function GET(request: Request) {
  try {
    const { ctx } = await requirePermission("accounting.read");
    const until = new URL(request.url).searchParams.get("until");
    if (!isIsoDate(until)) return NextResponse.json({ message: "Indica la fecha hasta la que calcular (until=AAAA-MM-DD)." }, { status: 400 });
    return NextResponse.json(await previewDepreciation(ctx.company.id, { until }));
  } catch (error) {
    return handleRouteError(error, "fixed-assets.depreciation.preview", "No se pudieron calcular las amortizaciones pendientes.");
  }
}

/**
 * Contabiliza las amortizaciones pendientes hasta la fecha indicada (68x al debe, 28x al haber),
 * un asiento por bien y periodo. Es idempotente: los periodos ya contabilizados no se repiten.
 */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = postDepreciationSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const result = await postDepreciation({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "fixed-assets.depreciation.post", "No se pudieron contabilizar las amortizaciones. Inténtalo de nuevo.");
  }
}
