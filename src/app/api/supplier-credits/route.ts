import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/rbac-server";
import { applySupplierCredit } from "@/server/supplier-invoices/credits";

const payloadSchema = z.object({
  creditInvoiceId: z.string().trim().min(1),
  supplierInvoiceId: z.string().trim().min(1),
  /** Sin importe se compensa todo lo posible. */
  amount: z.number().positive().optional(),
});

/** Compensa un abono de proveedor contra una factura pendiente del mismo proveedor (sin asiento). */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission(null);
    if (!can(ctx.membership.role, "purchase.write") && !can(ctx.membership.role, "expense.write")) {
      return NextResponse.json({ message: "Sin permisos para compensar abonos de proveedor." }, { status: 403 });
    }
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Indica el abono, la factura y un importe válido." }, { status: 400 });
    const result = await applySupplierCredit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data);
    return NextResponse.json({ applicationId: result.application.id, amount: result.amount, invoiceNumber: result.invoiceNumber }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "supplier-credits.apply", "No se pudo compensar el abono. Inténtalo de nuevo.");
  }
}
