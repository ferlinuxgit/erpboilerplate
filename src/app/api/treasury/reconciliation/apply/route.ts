import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { applyAllocations } from "@/server/treasury/workbench";

const allocationSchema = z.object({
  type: z.enum(["CUSTOMER_INVOICE", "SUPPLIER_INVOICE", "CUSTOMER_PAYMENT", "SUPPLIER_PAYMENT", "ACCOUNT"]),
  targetId: z.string().trim().min(1),
  amount: z.number().finite(),
});

const payloadSchema = z.object({
  transactionId: z.string().trim().min(1),
  allocations: z.array(allocationSchema).min(1).max(50),
  ruleId: z.string().trim().min(1).nullable().optional(),
  remember: z.object({
    conceptContains: z.string().trim().min(3).max(120),
    name: z.string().trim().max(120).optional(),
    direction: z.enum(["ANY", "IN", "OUT"]).optional(),
    minAmount: z.number().nonnegative().nullable().optional(),
    maxAmount: z.number().nonnegative().nullable().optional(),
    accountId: z.string().trim().min(1).nullable().optional(),
    partnerId: z.string().trim().min(1).nullable().optional(),
    autoApply: z.boolean().optional(),
  }).nullable().optional(),
});

/** Aplica una propuesta o un reparto manual a un movimiento pendiente. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite conciliar movimientos.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Datos del reparto no válidos." }, { status: 400 });
    const result = await applyAllocations(
      { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id, activeFiscalYearId: ctx.fiscalYear.id },
      parsed.data,
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "treasury.reconciliation.apply", "No se pudo conciliar el movimiento. Inténtalo de nuevo.");
  }
}
