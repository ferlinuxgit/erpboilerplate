import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { linkDirectDebitReturnMovement, listReturnCandidates, returnDirectDebitItem } from "@/server/sepa/direct-debits";

/** Cargos pendientes del banco que pueden ser la devolución de este recibo. */
export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const { ctx } = await requirePermission("treasury.read");
    const { itemId } = await params;
    return NextResponse.json(await listReturnCandidates(ctx.company.id, itemId));
  } catch (error) {
    return handleRouteError(error, "sepa.direct_debits.return_candidates");
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("return"),
    returnedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().max(250).nullable().optional(),
    bankTransactionId: z.string().trim().min(1).nullable().optional(),
    feeAccountId: z.string().trim().min(1).nullable().optional(),
  }),
  z.object({
    action: z.literal("link"),
    bankTransactionId: z.string().trim().min(1),
    feeAccountId: z.string().trim().min(1).nullable().optional(),
  }),
]);

/** Devolución de un recibo (y, opcionalmente, conciliación del cargo con su comisión). */
export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite gestionar remesas.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Revisa la fecha de la devolución y el cargo elegido." }, { status: 400 });
    const { itemId } = await params;
    const actor = { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id, activeFiscalYearId: ctx.fiscalYear.id };
    if (parsed.data.action === "link") {
      return NextResponse.json(await linkDirectDebitReturnMovement(actor, itemId, { bankTransactionId: parsed.data.bankTransactionId, feeAccountId: parsed.data.feeAccountId }));
    }
    const returnedAt = new Date(`${parsed.data.returnedAt}T00:00:00.000Z`);
    if (Number.isNaN(returnedAt.getTime())) return NextResponse.json({ message: "Fecha de devolución no válida." }, { status: 400 });
    return NextResponse.json(await returnDirectDebitItem(actor, itemId, {
      returnedAt,
      reason: parsed.data.reason,
      bankTransactionId: parsed.data.bankTransactionId,
      feeAccountId: parsed.data.feeAccountId,
    }));
  } catch (error) {
    return handleRouteError(error, "sepa.direct_debits.return", "No se pudo registrar la devolución.");
  }
}
