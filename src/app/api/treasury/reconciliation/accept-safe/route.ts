import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { acceptSafeSuggestions } from "@/server/treasury/workbench";

const payloadSchema = z.object({
  bankAccountId: z.string().trim().min(1).optional(),
  transactionIds: z.array(z.string().trim().min(1)).max(200).optional(),
});

/** "Aceptar todas las seguras": aplica solo las propuestas de confianza alta y sin rival. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite conciliar movimientos.");
    const parsed = payloadSchema.safeParse((await readJsonBody(request)) ?? {});
    if (!parsed.success) return NextResponse.json({ message: "Datos no válidos." }, { status: 400 });
    const result = await acceptSafeSuggestions(
      { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id, activeFiscalYearId: ctx.fiscalYear.id },
      parsed.data,
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "treasury.reconciliation.accept-safe", "No se pudieron aplicar las propuestas. Inténtalo de nuevo.");
  }
}
