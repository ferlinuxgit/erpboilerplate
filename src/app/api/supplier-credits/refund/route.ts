import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/rbac-server";
import { registerSupplierCreditRefund } from "@/server/supplier-invoices/credits";

const payloadSchema = z.object({
  creditInvoiceId: z.string().trim().min(1),
  amount: z.number().positive(),
  postedAt: z.string().trim().min(1),
  bankAccountId: z.string().trim().min(1),
  reference: z.string().trim().max(160).optional().or(z.literal("")),
});

/** Devolución de un abono cobrada por banco: asiento banco a 400/410 y menos saldo a favor. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission(null);
    if (!can(ctx.membership.role, "purchase.write") && !can(ctx.membership.role, "expense.write")) {
      return NextResponse.json({ message: "Sin permisos para registrar devoluciones de proveedor." }, { status: 403 });
    }
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Indica el importe, la fecha y la cuenta bancaria." }, { status: 400 });
    const postedAt = new Date(parsed.data.postedAt);
    if (Number.isNaN(postedAt.getTime())) return NextResponse.json({ message: "Fecha inválida." }, { status: 400 });
    const result = await registerSupplierCreditRefund(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id },
      { creditInvoiceId: parsed.data.creditInvoiceId, amount: parsed.data.amount, postedAt, bankAccountId: parsed.data.bankAccountId, reference: parsed.data.reference || null },
    );
    return NextResponse.json({ applicationId: result.application.id, amount: result.amount }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "supplier-credits.refund", "No se pudo registrar la devolución. Inténtalo de nuevo.");
  }
}
